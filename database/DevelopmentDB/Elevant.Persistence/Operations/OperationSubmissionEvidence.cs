using System.Text.Json;
using Elevant.Application.Operations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// The submitted evidence is a value snapshot. Live service and incident rows may change
/// during a later correction, but an earlier OCC handoff must never change with them.
/// </summary>
internal sealed record OperationSubmissionEvidence(
    int Version,
    OccReviewServiceData[] Services,
    OccReviewIncidentData[] Incidents,
    ServiceChargeEvidence[]? Charges = null,
    ServiceTimingEvidence[]? Timings = null)
{
    /// <summary>Version 3 freezes recorded durations/delays; versions 1 and 2 remain readable.</summary>
    public const int CurrentVersion = 3;

    public IReadOnlyList<ServiceChargeEvidence> ChargesOf(Guid serviceId) =>
        (Charges ?? []).Where(charge => charge.ServiceId == serviceId).ToArray();

    public ServiceTimingEvidence? TimingOf(Guid serviceId) => (Timings ?? []).SingleOrDefault(item => item.ServiceId == serviceId);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<OperationSubmissionEvidence> CaptureAsync(
        ElevantDbContext context, long operationId, CancellationToken cancellationToken, DateTimeOffset? submittedAt = null)
    {
        var services = await (
            from service in context.OperationServices.AsNoTracking()
            join definition in context.ServiceDefinitions.AsNoTracking()
                on service.ServiceDefinitionId equals definition.Id
            where service.GroundOperationId == operationId
            orderby service.LineNumber
            select new OccReviewServiceData(
                service.PublicId, definition.Code, definition.Name,
                service.CurrentStatus.ToString(), service.ContractedQuantity,
                service.ExecutedQuantity, service.BillingUnitSnapshot))
            .ToArrayAsync(cancellationToken);
        var incidents = await context.Incidents.AsNoTracking()
            .Where(item => item.GroundOperationId == operationId)
            .OrderBy(item => item.OccurredAt)
            .ThenBy(item => item.Id)
            .Select(item => new OccReviewIncidentData(
                item.PublicId, item.IncidentType, item.Severity.ToString(),
                item.Status.ToString(), item.Description, item.OccurredAt))
            .ToArrayAsync(cancellationToken);
        var charges = await (
            from mark in context.OperationServiceCharges.AsNoTracking()
            join service in context.OperationServices.AsNoTracking() on mark.OperationServiceId equals service.Id
            join charge in context.ChargeDefinitions.AsNoTracking() on mark.ChargeDefinitionId equals charge.Id
            where service.GroundOperationId == operationId && mark.RemovedAt == null
            orderby service.LineNumber, mark.AppliedAt, mark.Id
            select new ServiceChargeEvidence(mark.PublicId, service.PublicId, charge.PublicId, charge.Code, mark.AppliedAt))
            .ToArrayAsync(cancellationToken);
        var operation = await context.GroundOperations.AsNoTracking().SingleAsync(item => item.Id == operationId, cancellationToken);
        var endAt = submittedAt ?? operation.ActualEndAt;
        var events = await (from item in context.Set<Elevant.Domain.Entities.Operations.OperationServiceStatusEvent>().AsNoTracking()
            join service in context.OperationServices.AsNoTracking() on item.OperationServiceId equals service.Id
            where service.GroundOperationId == operationId && (endAt == null || item.OccurredAt <= endAt)
            orderby item.OccurredAt select new { service.PublicId, item.OccurredAt, item.ToStatus }).ToArrayAsync(cancellationToken);
        var arrivals = await context.FlightLegs.AsNoTracking().Where(leg => leg.TurnaroundId == operation.TurnaroundId && leg.Direction == Elevant.Domain.Enumerations.FlightDirection.Arrival).ToArrayAsync(cancellationToken);
        var arrival = arrivals.Length == 1 ? arrivals[0] : null;
        static decimal? Minutes(DateTimeOffset? start, DateTimeOffset? end) => start is { } a && end is { } b ? Math.Max(0m, (decimal)(b - a).Ticks / TimeSpan.TicksPerMinute) : null;
        var timings = services.Select(service => {
            var serviceEvents = events.Where(item => item.PublicId == service.Id).ToArray();
            var start = serviceEvents.LastOrDefault(item => item.ToStatus == Elevant.Domain.Enumerations.ServiceExecutionStatus.InProgress)?.OccurredAt;
            var end = serviceEvents.LastOrDefault(item => item.ToStatus is Elevant.Domain.Enumerations.ServiceExecutionStatus.Completed or Elevant.Domain.Enumerations.ServiceExecutionStatus.Exception && item.OccurredAt >= start)?.OccurredAt;
            return new ServiceTimingEvidence(service.Id, Minutes(start, end), Minutes(operation.PlannedEndAt, endAt), Minutes(arrival?.ScheduledAt, arrival?.ActualAt));
        }).ToArray();
        return new OperationSubmissionEvidence(CurrentVersion, services, incidents, charges, timings);
    }

    public string ToJson() => JsonSerializer.Serialize(this, JsonOptions);

    public static OperationSubmissionEvidence Parse(string json)
    {
        var evidence = JsonSerializer.Deserialize<OperationSubmissionEvidence>(json, JsonOptions);
        if (evidence is not { Version: 1 or 2 or 3, Services: not null, Incidents: not null })
            throw new InvalidOperationException("The submitted evidence snapshot is invalid.");
        return evidence;
    }
}

/// <summary>A charge the agent had marked on a service when the delivery was submitted.</summary>
internal sealed record ServiceChargeEvidence(Guid MarkId, Guid ServiceId, Guid ChargeId, string Code, DateTimeOffset AppliedAt);

/// <summary>Server-recorded measurements frozen at submission; no itinerary estimates are treated as execution.</summary>
internal sealed record ServiceTimingEvidence(Guid ServiceId, decimal? ServiceMinutes, decimal? OperationOverrunMinutes, decimal? ArrivalDelayMinutes);
