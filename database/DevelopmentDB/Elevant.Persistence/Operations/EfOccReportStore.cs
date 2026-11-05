using System.Globalization;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Builds the OCC reports from the authoritative operation, review and service rows of one
/// station and period. Reports are projections: nothing is stored except the export audit.
/// </summary>
internal sealed class EfOccReportStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IOccReportStore
{
    private static readonly CultureInfo Spanish = CultureInfo.GetCultureInfo("es-DO");

    private sealed record OperationRow(long Id, long TurnaroundId, DateOnly Date, string Code, string Airline,
        string? Registration, GroundOperationStatus Status, DateTimeOffset? PlannedStart, DateTimeOffset? PlannedEnd,
        DateTimeOffset? ActualStart, DateTimeOffset? ActualEnd);

    public async Task<OccReportResult> ReadAsync(Guid actorId, OccReportKind kind, Guid stationId, DateOnly from,
        DateOnly to, int page, int limit, CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(kind) || page < 1 || limit is < 1 or > 5000 || !OccReportCatalog.ValidRange(from, to))
            throw new ArgumentException("The report query is invalid.");
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, "operations.reports.read", stationId))
            return new(null, OccReportFailure.Forbidden);
        var station = await context.Stations.AsNoTracking()
            .Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.Code, item.IanaTimeZone })
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null) return new(null, OccReportFailure.StationNotFound);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.IanaTimeZone);

        var operations = await (from turnaround in context.Turnarounds.AsNoTracking()
                                join operation in context.GroundOperations.AsNoTracking() on turnaround.Id equals operation.TurnaroundId
                                join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                                where turnaround.StationId == station.Id &&
                                      turnaround.OperationDate >= @from && turnaround.OperationDate <= to
                                orderby turnaround.OperationDate, turnaround.OperationCode, operation.Id
                                select new OperationRow(operation.Id, turnaround.Id, turnaround.OperationDate,
                                    turnaround.OperationCode, airline.Name, turnaround.AircraftRegistration,
                                    operation.CurrentStatus, operation.PlannedStartAt, operation.PlannedEndAt,
                                    operation.ActualStartAt, operation.ActualEndAt))
            .ToArrayAsync(cancellationToken);
        var ids = operations.Select(item => item.Id).ToArray();
        var rows = kind switch
        {
            OccReportKind.Operations => await OperationsAsync(operations, ids, zone, cancellationToken),
            OccReportKind.TurnaroundTimes => TurnaroundTimes(operations),
            OccReportKind.ServicesByAirline => await ServicesAsync(operations, ids, cancellationToken),
            OccReportKind.Reviews => await ReviewsAsync(operations, ids, zone, cancellationToken),
            OccReportKind.DailyClose => await DailyCloseAsync(operations, ids, zone, cancellationToken),
            _ => await ProductivityAsync(operations, ids, cancellationToken),
        };
        var slice = rows.Skip((page - 1) * limit).Take(limit + 1).ToArray();
        var definition = OccReportCatalog.All.Single(item => item.Kind == kind);
        return new(new OccReportTable(definition, stationId, station.Code, from, to, timeProvider.GetUtcNow(),
            slice.Take(limit).ToArray(), page, limit, slice.Length > limit), null);
    }

    public async Task<OccReportFailure?> RecordExportAsync(Guid actorId, OccReportKind kind, Guid stationId,
        DateOnly from, DateOnly to, string format, int rows, CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(kind) || format is not ("csv" or "xlsx" or "pdf") || rows < 0 ||
            !OccReportCatalog.ValidRange(from, to))
            throw new ArgumentException("The export audit is invalid.");
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, "operations.reports.export", stationId)) return OccReportFailure.Forbidden;
        var stationKey = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (stationKey is null) return OccReportFailure.StationNotFound;
        var accountKey = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = timeProvider.GetUtcNow(),
            ActorType = AuditActorType.Account, ActorAccountId = accountKey,
            Action = "operations.report.exported", EntityType = "ops.reports", StationId = stationKey,
            Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            MetadataJson = JsonSerializer.Serialize(new { Kind = kind.ToString(), From = from, To = to, Format = format, RowCount = rows }),
        });
        await context.SaveChangesAsync(cancellationToken);
        return null;
    }

    private static bool Allowed(ActorContext? actor, string permission, Guid stationId) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
            membership.Kind == MembershipKind.InternalStaff) &&
        actor.StationScopes.Any(scope => scope.StationId == stationId);

    private async Task<List<IReadOnlyList<OccReportCell>>> OperationsAsync(OperationRow[] operations, long[] ids,
        TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        var agents = (await (from assignment in context.OperationAgentAssignments.AsNoTracking()
                             join agent in context.RampAgents.AsNoTracking() on assignment.RampAgentId equals agent.Id
                             join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                             where ids.Contains(assignment.GroundOperationId) && assignment.ReleasedAt == null
                             select new { assignment.GroundOperationId, Name = person.FirstName + " " + person.LastName })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId, item => item.Name);
        return operations.Select(item => (IReadOnlyList<OccReportCell>)
        [
            Text(Date(item.Date)), Text(item.Code), Text(item.Airline), Text(item.Registration ?? "—"),
            Text(Status(item.Status)), Text(Time(item.PlannedStart, zone)), Text(Time(item.PlannedEnd, zone)),
            Text(Time(item.ActualStart, zone)), Text(Time(item.ActualEnd, zone)),
            Text(agents[item.Id].Any() ? string.Join(", ", agents[item.Id].Order()) : "Sin asignar"),
        ]).ToList();
    }

    private static List<IReadOnlyList<OccReportCell>> TurnaroundTimes(OperationRow[] operations) =>
        operations.Where(item => item.ActualStart is not null && item.ActualEnd is not null)
            .Select(item =>
            {
                var actual = Minutes(item.ActualStart, item.ActualEnd)!.Value;
                var planned = Minutes(item.PlannedStart, item.PlannedEnd);
                return (IReadOnlyList<OccReportCell>)
                [
                    Text(Date(item.Date)), Text(item.Code), Text(item.Airline),
                    planned is { } value ? OccReportCell.Number(value) : Text("—"), OccReportCell.Number(actual),
                    planned is { } plan ? OccReportCell.Number(actual - plan) : Text("—"),
                ];
            }).ToList();

    private async Task<List<IReadOnlyList<OccReportCell>>> ServicesAsync(OperationRow[] operations, long[] ids,
        CancellationToken cancellationToken)
    {
        var airlineOf = operations.ToDictionary(item => item.Id, item => item.Airline);
        var services = await (from service in context.OperationServices.AsNoTracking()
                              join definition in context.ServiceDefinitions.AsNoTracking() on service.ServiceDefinitionId equals definition.Id
                              where ids.Contains(service.GroundOperationId) && service.CurrentStatus != ServiceExecutionStatus.NotPerformed
                              select new { service.GroundOperationId, definition.Name, service.BillingUnitSnapshot,
                                  service.ContractedQuantity, service.ExecutedQuantity })
            .ToArrayAsync(cancellationToken);
        return services.GroupBy(item => (Airline: airlineOf[item.GroundOperationId], item.Name, item.BillingUnitSnapshot))
            .OrderBy(group => group.Key.Airline, StringComparer.CurrentCulture).ThenBy(group => group.Key.Name, StringComparer.CurrentCulture)
            .Select(group => (IReadOnlyList<OccReportCell>)
            [
                Text(group.Key.Airline), Text(group.Key.Name), Text(group.Key.BillingUnitSnapshot),
                OccReportCell.Number(group.Select(item => item.GroundOperationId).Distinct().Count()),
                OccReportCell.Number(group.Sum(item => item.ContractedQuantity)),
                OccReportCell.Number(group.Sum(item => item.ExecutedQuantity)),
            ]).ToList();
    }

    private async Task<List<IReadOnlyList<OccReportCell>>> ReviewsAsync(OperationRow[] operations, long[] ids,
        TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        var byId = operations.ToDictionary(item => item.Id);
        var decisions = await (from decision in context.ReviewDecisions.AsNoTracking()
                               join submission in context.OperationSubmissions.AsNoTracking() on decision.OperationSubmissionId equals submission.Id
                               where ids.Contains(submission.GroundOperationId)
                               orderby decision.DecidedAt
                               select new { submission.GroundOperationId, submission.RevisionNumber, decision.Outcome,
                                   decision.Reason, decision.DecidedAt })
            .ToArrayAsync(cancellationToken);
        var incidents = (await context.Incidents.AsNoTracking().Where(item => ids.Contains(item.GroundOperationId))
                .Select(item => new { item.GroundOperationId, item.IncidentType, item.Severity }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId);
        return decisions.Select(item =>
        {
            var operation = byId[item.GroundOperationId];
            var reported = incidents[item.GroundOperationId].ToArray();
            return (IReadOnlyList<OccReportCell>)
            [
                Text(Date(operation.Date)), Text(operation.Code), Text(operation.Airline),
                OccReportCell.Number(item.RevisionNumber), Text(item.Outcome == ReviewOutcome.Approved ? "Aprobada" : "Devuelta"),
                Text(string.IsNullOrWhiteSpace(item.Reason) ? "—" : item.Reason.Trim()), Text(DateTime(item.DecidedAt, zone)),
                Text(reported.Length == 0 ? "Ninguna"
                    : string.Join("; ", reported.Select(incident => $"{incident.IncidentType} ({Severity(incident.Severity)})"))),
            ];
        }).ToList();
    }

    private async Task<List<IReadOnlyList<OccReportCell>>> ProductivityAsync(OperationRow[] operations, long[] ids,
        CancellationToken cancellationToken)
    {
        var byId = operations.ToDictionary(item => item.Id);
        var assignments = await (from assignment in context.OperationAgentAssignments.AsNoTracking()
                                 join agent in context.RampAgents.AsNoTracking() on assignment.RampAgentId equals agent.Id
                                 join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                                 where ids.Contains(assignment.GroundOperationId)
                                 select new { assignment.GroundOperationId, agent.Id, agent.EmployeeNumber,
                                     Name = person.FirstName + " " + person.LastName })
            .ToArrayAsync(cancellationToken);
        return assignments.GroupBy(item => (item.Id, item.Name, item.EmployeeNumber))
            .OrderBy(group => group.Key.Name, StringComparer.CurrentCulture)
            .Select(group =>
            {
                var worked = group.Select(item => item.GroundOperationId).Distinct().Select(id => byId[id]).ToArray();
                return (IReadOnlyList<OccReportCell>)
                [
                    Text(group.Key.Name), Text(group.Key.EmployeeNumber), OccReportCell.Number(worked.Length),
                    OccReportCell.Number(worked.Count(item => item.Status == GroundOperationStatus.Approved)),
                    OccReportCell.Number(worked.Count(item => item.Status == GroundOperationStatus.Returned)),
                    OccReportCell.Number(worked.Sum(item => Minutes(item.ActualStart, item.ActualEnd) ?? 0)),
                ];
            }).ToList();
    }

    /// <summary>
    /// The day's operational close OCC used to build by hand (ADR-0034). The notice is the minutes
    /// between the last stand change and block-on: negative when the stand changed after the aircraft
    /// blocked, empty when the stand never changed.
    /// </summary>
    private async Task<List<IReadOnlyList<OccReportCell>>> DailyCloseAsync(OperationRow[] operations, long[] ids,
        TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        var turnaroundIds = operations.Select(item => item.TurnaroundId).Distinct().ToArray();
        var legs = (await context.FlightLegs.AsNoTracking().Where(leg => turnaroundIds.Contains(leg.TurnaroundId))
                .Select(leg => new { leg.TurnaroundId, leg.Direction, leg.FlightNumber, leg.ScheduledAt, leg.ActualAt })
                .ToArrayAsync(cancellationToken))
            .ToLookup(leg => leg.TurnaroundId);
        var stands = (await (from assignment in context.Set<Elevant.Domain.Entities.Operations.StandAssignment>().AsNoTracking()
                             join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                             where turnaroundIds.Contains(assignment.TurnaroundId)
                             orderby assignment.AssignedFrom, assignment.Id
                             select new { assignment.TurnaroundId, stand.Code, assignment.AssignedFrom })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.TurnaroundId);
        var milestones = (await context.Set<Elevant.Domain.Entities.Operations.OperationMilestone>().AsNoTracking()
                .Where(item => ids.Contains(item.GroundOperationId) && item.ActualAt != null &&
                    (item.Code == "BLOCK_ON" || item.Code == "PUSHBACK"))
                .Select(item => new { item.GroundOperationId, item.Code, item.ActualAt }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId);
        var categories = await (from turnaround in context.Turnarounds.AsNoTracking()
                                join type in context.AircraftTypes.AsNoTracking() on turnaround.AircraftTypeId equals type.Id
                                where turnaroundIds.Contains(turnaround.Id)
                                select new { turnaround.Id, type.SizeCategory }).ToDictionaryAsync(item => item.Id,
            item => item.SizeCategory, cancellationToken);
        var allowances = await context.GroundTimeAllowances.AsNoTracking()
            .ToDictionaryAsync(item => item.SizeCategory, item => item.AllowedMinutes, cancellationToken);
        var incidents = (await context.Incidents.AsNoTracking().Where(item => ids.Contains(item.GroundOperationId))
                .Select(item => new { item.GroundOperationId, item.DelayCode }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId);
        return operations.Select(item =>
        {
            var arrival = legs[item.TurnaroundId].FirstOrDefault(leg => leg.Direction == FlightDirection.Arrival);
            var departure = legs[item.TurnaroundId].FirstOrDefault(leg => leg.Direction == FlightDirection.Departure);
            var history = stands[item.TurnaroundId].ToArray();
            var blockOn = milestones[item.Id].FirstOrDefault(mark => mark.Code == "BLOCK_ON")?.ActualAt ?? item.ActualStart;
            var pushback = milestones[item.Id].FirstOrDefault(mark => mark.Code == "PUSHBACK")?.ActualAt ?? item.ActualEnd;
            decimal? notice = history.Length > 1 && blockOn is { } blocked
                ? Math.Round((decimal)(blocked - history[^1].AssignedFrom).TotalMinutes, 0) : null;
            var ground = Elevant.Application.Operations.AutomaticSurchargePolicy.GroundMinutes(blockOn, pushback);
            int? allowed = categories.TryGetValue(item.TurnaroundId, out var category) && category is { } size &&
                allowances.TryGetValue(size, out var minutes) ? minutes : null;
            var reported = incidents[item.Id].ToArray();
            var delays = reported.Select(incident => incident.DelayCode).OfType<string>().Distinct().Order().ToArray();
            return (IReadOnlyList<OccReportCell>)
            [
                Text(Date(item.Date)), Text(item.Code), Text(item.Airline),
                Text(string.Join(" / ", new[] { arrival?.FlightNumber, departure?.FlightNumber }.OfType<string>())),
                Text(Time(arrival?.ScheduledAt, zone)), Text(Time(arrival?.ActualAt, zone)),
                Text(Time(departure?.ScheduledAt, zone)), Text(Time(pushback, zone)),
                Text(history.FirstOrDefault()?.Code ?? "—"), Text(history.LastOrDefault()?.Code ?? "—"),
                notice is { } value ? OccReportCell.Number(value) : Text("—"),
                ground is { } groundMinutes ? OccReportCell.Number(groundMinutes) : Text("—"),
                allowed is { } allowance ? OccReportCell.Number(allowance) : Text("—"),
                Text(delays.Length == 0 ? "—" : string.Join(", ", delays)),
                OccReportCell.Number(reported.Length),
                Text(Status(item.Status)),
            ];
        }).ToList();
    }

    private static OccReportCell Text(string value) => new(value);

    private static decimal? Minutes(DateTimeOffset? start, DateTimeOffset? end) =>
        start is { } s && end is { } e && e >= s ? Math.Round((decimal)(e - s).TotalMinutes, 0) : null;

    private static string Date(DateOnly value) => value.ToString("dd/MM/yyyy", Spanish);

    private static string Time(DateTimeOffset? value, TimeZoneInfo zone) =>
        value is { } instant ? TimeZoneInfo.ConvertTime(instant, zone).ToString("HH:mm", Spanish) : "—";

    private static string DateTime(DateTimeOffset value, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTime(value, zone).ToString("dd/MM/yyyy HH:mm", Spanish);

    private static string Status(GroundOperationStatus status) => status switch
    {
        GroundOperationStatus.Planned => "Planificada",
        GroundOperationStatus.Assigned => "Asignada",
        GroundOperationStatus.InProgress => "En curso",
        GroundOperationStatus.PendingReview => "Pendiente de revisión",
        GroundOperationStatus.InReview => "En revisión",
        GroundOperationStatus.Approved => "Aprobada",
        GroundOperationStatus.Returned => "Devuelta",
        GroundOperationStatus.Cancelled => "Cancelada",
        _ => status.ToString(),
    };

    private static string Severity(IncidentSeverity severity) => severity switch
    {
        IncidentSeverity.Low => "baja",
        IncidentSeverity.Medium => "media",
        IncidentSeverity.High => "alta",
        IncidentSeverity.Critical => "crítica",
        _ => severity.ToString(),
    };
}
