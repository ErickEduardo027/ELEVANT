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
    ServiceChargeEvidence[]? Charges = null)
{
    /// <summary>Version 2 adds the charges the agent marked; version 1 snapshots carry none.</summary>
    public const int CurrentVersion = 2;

    public IReadOnlyList<ServiceChargeEvidence> ChargesOf(Guid serviceId) =>
        (Charges ?? []).Where(charge => charge.ServiceId == serviceId).ToArray();

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task<OperationSubmissionEvidence> CaptureAsync(
        ElevantDbContext context, long operationId, CancellationToken cancellationToken)
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
        return new OperationSubmissionEvidence(CurrentVersion, services, incidents, charges);
    }

    public string ToJson() => JsonSerializer.Serialize(this, JsonOptions);

    public static OperationSubmissionEvidence Parse(string json)
    {
        var evidence = JsonSerializer.Deserialize<OperationSubmissionEvidence>(json, JsonOptions);
        if (evidence is not { Version: 1 or 2, Services: not null, Incidents: not null })
            throw new InvalidOperationException("The submitted evidence snapshot is invalid.");
        return evidence;
    }
}

/// <summary>A charge the agent had marked on a service when the delivery was submitted.</summary>
internal sealed record ServiceChargeEvidence(Guid MarkId, Guid ServiceId, Guid ChargeId, string Code, DateTimeOffset AppliedAt);
