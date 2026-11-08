using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Operations;

/// <summary>
/// OCC manages the incidents of an operation of its stations (3-G): the live list (not the evidence frozen at the
/// hand-off), its own reports and the state changes with their note. Every command runs in one serializable
/// transaction with its Idempotency-Key receipt (<see cref="MasterDataCommand"/>); a state change checks the incident's
/// version OCC saw. Each step is kept in <c>ops.incident_status_events</c>, audited and announced to OCC's review
/// (<c>occ_review</c>) and to the agent's tablet, which keeps reading the same keys.
/// </summary>
internal sealed class EfOccIncidentStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider timeProvider)
    : IOccIncidentStore
{
    private const string ReportAction = "occ.incident.report";
    private const string StatusAction = "occ.incident.status_change";

    /// <summary>The first step of an incident the ramp agent reported from the tablet.</summary>
    public const string RampReportedNote = "Reportada desde la tablet.";

    /// <summary>The first step of an incident OCC reported.</summary>
    public const string OccReportedNote = "Reportada por OCC.";

    private sealed record OperationScope(long OperationId, Guid OperationPublicId, string OperationCode,
        GroundOperationStatus Status, long StationId, string TimeZone, long AirlineOrganizationId, long TurnaroundId,
        DateOnly OperationDate);

    public async Task<MasterDataResult<OccIncidentListData>> ListAsync(Guid actorId, Guid operationId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, OccIncidentPolicy.ReadPermission))
            return MasterDataResult<OccIncidentListData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        var scope = await ScopeAsync(actor!, operationId, cancellationToken);
        if (scope is null) return MasterDataResult<OccIncidentListData>.Failed(MasterDataFailure.NotFound, "not_found");
        var ids = await context.Incidents.AsNoTracking()
            .Where(incident => incident.GroundOperationId == scope.OperationId)
            .OrderBy(incident => incident.OccurredAt).ThenBy(incident => incident.ReportedAt).ThenBy(incident => incident.Id)
            .Select(incident => incident.PublicId)
            .ToArrayAsync(cancellationToken);
        return MasterDataResult<OccIncidentListData>.Success(new OccIncidentListData(scope.OperationPublicId,
            scope.OperationCode, scope.Status.ToString(), scope.TimeZone, OccIncidentPolicy.CanReport(scope.Status),
            await IncidentsAsync(ids, cancellationToken)));
    }

    public async Task<MasterDataResult<OccIncidentData>> ReportAsync(Guid actorId, Guid operationId,
        OccIncidentReportInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, OccIncidentPolicy.UpdatePermission))
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        var type = input.IncidentType?.Trim();
        var severity = OccIncidentPolicy.ParseSeverity(input.Severity);
        var description = input.Description?.Trim();
        var delayCode = string.IsNullOrWhiteSpace(input.DelayCode) ? null : input.DelayCode.Trim().ToUpperInvariant();
        if (severity is not { } level || input.OccurredAt is not { } occurredValue ||
            !RampIncidentPolicy.IsValid(type, level, description, occurredValue, delayCode))
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Invalid, OccIncidentCodes.ReportInvalid);
        var scope = await ScopeAsync(actor!, operationId, cancellationToken);
        if (scope is null) return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.NotFound, "not_found");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var occurredAt = Truncate(occurredValue);
        var hash = CommercialCommandReceipts.Hash(new
        {
            operationId, type, severity = level.ToString(), description, occurredAt, delayCode,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, key, accountId, ReportAction, hash, "version_conflict", now,
            () => ReportInsideAsync(scope, accountId, type!, level, description!, occurredAt, delayCode, now,
                cancellationToken),
            id => IncidentAsync(id, cancellationToken), cancellationToken);
    }

    public async Task<MasterDataResult<OccIncidentData>> ChangeStatusAsync(Guid actorId, Guid incidentId,
        OccIncidentStatusInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, OccIncidentPolicy.UpdatePermission))
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Invalid, "expected_version_required");
        if (OccIncidentPolicy.ParseStatus(input.Status) is not { } target)
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Invalid, OccIncidentCodes.TransitionInvalid);
        if (OccIncidentPolicy.Note(input.Note) is not { } note)
            return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.Invalid, "reason_required");
        var operationId = await context.Incidents.AsNoTracking().Where(incident => incident.PublicId == incidentId)
            .Join(context.GroundOperations.AsNoTracking(), incident => incident.GroundOperationId,
                operation => operation.Id, (_, operation) => (Guid?)operation.PublicId)
            .SingleOrDefaultAsync(cancellationToken);
        var scope = operationId is Guid operationPublicId
            ? await ScopeAsync(actor!, operationPublicId, cancellationToken) : null;
        if (scope is null) return MasterDataResult<OccIncidentData>.Failed(MasterDataFailure.NotFound, "not_found");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            incidentId, status = target.ToString(), note, expected = input.ExpectedVersion,
        });
        var now = Now();
        return await MasterDataCommand.RunAsync(context, key, accountId, StatusAction, hash, "version_conflict", now,
            () => ChangeInsideAsync(scope, accountId, incidentId, target, note, input.ExpectedVersion!, now,
                cancellationToken),
            id => IncidentAsync(id, cancellationToken), cancellationToken);
    }

    private async Task<Step> ReportInsideAsync(OperationScope scope, long accountId, string type, IncidentSeverity severity,
        string description, DateTimeOffset occurredAt, string? delayCode, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // The operation's state is read under lock: an approval running at the same time comes first or after.
        var operation = await context.GroundOperations.FromSqlInterpolated($"""
                SELECT * FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [id] = {scope.OperationId}
                """).AsNoTracking().SingleAsync(cancellationToken);
        if (!OccIncidentPolicy.CanReport(operation.CurrentStatus))
            return Step.Fail(MasterDataFailure.Conflict, OccIncidentCodes.OperationClosed);
        var arrivals = await context.FlightLegs.AsNoTracking()
            .Where(leg => leg.TurnaroundId == scope.TurnaroundId && leg.Direction == FlightDirection.Arrival)
            .Select(leg => leg.ActualAt).ToArrayAsync(cancellationToken);
        var arrivedAt = arrivals.Length == 1 ? arrivals[0] : null;
        // Started, the window is the tablet's (3-N25): from the start, or the recorded arrival when it came first. Not
        // started yet, it opens at the arrival or the planned start, otherwise at the start of the operation's day.
        var opens = operation.ActualStartAt is { } started
            ? RampEvidenceTimePolicy.WindowFor(started, arrivedAt, null, now).Opens + RampEvidenceTimePolicy.ClockTolerance
            : new[] { arrivedAt, operation.PlannedStartAt }.OfType<DateTimeOffset>()
                .DefaultIfEmpty(BusinessCalendar.StartOfDay(scope.OperationDate, scope.TimeZone)).Min();
        if (!OccIncidentPolicy.IsValidOccurredAt(occurredAt, opens, now))
            return Step.Fail(MasterDataFailure.Invalid, OccIncidentCodes.OccurredAtInvalid);
        var incident = new Incident
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = scope.OperationId, ReportedByAccountId = accountId,
            IncidentType = type, Severity = severity, Status = IncidentStatus.Open, Description = description,
            DelayCode = delayCode, OccurredAt = RampEvidenceTimePolicy.Clamp(occurredAt, now), ReportedAt = now,
            CreatedAt = now, UpdatedAt = now,
        };
        context.Incidents.Add(incident);
        await context.SaveChangesAsync(cancellationToken);
        context.Set<IncidentStatusEvent>().Add(new IncidentStatusEvent
        {
            IncidentId = incident.Id, FromStatus = null, ToStatus = IncidentStatus.Open, Note = OccReportedNote,
            OccurredAt = now, ActorAccountId = accountId,
        });
        Audit(scope, accountId, incident, "occ.incident.reported", "OCC reportó una incidencia de la operación.", now,
            new { operationId = scope.OperationPublicId, incidentType = type, severity = severity.ToString(), delayCode });
        // The same alert kinds as the tablet's reports (ADR-0031), to OCC's other accounts of the station.
        await OperationalNotificationWriter.NotifyOccAsync(context, scope.StationId, scope.OperationId, incident.PublicId,
            type == RampIncidentPolicy.Deviation ? "deviation_reported" : "incident_reported", now, accountId,
            cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, scope.OperationId, now, true, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return Step.Done(incident.PublicId);
    }

    private async Task<Step> ChangeInsideAsync(OperationScope scope, long accountId, Guid incidentId,
        IncidentStatus target, string note, string expectedVersion, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var incident = await context.Incidents.FromSqlInterpolated($"""
                SELECT * FROM [ops].[incidents] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {incidentId}
                """).SingleAsync(cancellationToken);
        if (MasterDataCommand.Version(incident.RowVersion) != expectedVersion)
            return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
        if (!OccIncidentPolicy.CanTransition(incident.Status, target))
            return Step.Fail(MasterDataFailure.Conflict, OccIncidentCodes.TransitionInvalid);
        var from = incident.Status;
        incident.Status = target;
        if (target == IncidentStatus.Resolved)
        {
            incident.ResolvedAt = now;
            incident.ResolvedByAccountId = accountId;
            incident.ResolutionNote = note;
        }
        else if (target == IncidentStatus.InReview)
        {
            // Taken back into review: the resolution it had stays in the history only.
            incident.ResolvedAt = null;
            incident.ResolvedByAccountId = null;
            incident.ResolutionNote = null;
        }
        incident.UpdatedAt = now;
        context.Set<IncidentStatusEvent>().Add(new IncidentStatusEvent
        {
            IncidentId = incident.Id, FromStatus = from, ToStatus = target, Note = note, OccurredAt = now,
            ActorAccountId = accountId,
        });
        Audit(scope, accountId, incident, "occ.incident.status_changed", note, now,
            new { operationId = scope.OperationPublicId, from = from.ToString(), to = target.ToString() });
        await RampOperationChangeWriter.AnnounceAsync(context, scope.OperationId, now, true, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return Step.Done(incident.PublicId);
    }

    /// <summary>The operation when one of the actor's stations holds it; null otherwise.</summary>
    private async Task<OperationScope?> ScopeAsync(ActorContext actor, Guid operationId, CancellationToken cancellationToken)
    {
        var stations = actor.StationScopes.Select(scope => scope.StationId).Where(id => id != Guid.Empty).Distinct().ToArray();
        if (stations.Length == 0) return null;
        var row = await (from operation in context.GroundOperations.AsNoTracking()
                         join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                         join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                         join airline in context.Airlines.AsNoTracking() on turnaround.AirlineId equals airline.Id
                         where operation.PublicId == operationId && station.IsActive && stations.Contains(station.PublicId)
                         select new
                         {
                             operation.Id, operation.PublicId, turnaround.OperationCode, operation.CurrentStatus,
                             StationId = station.Id, station.IanaTimeZone, airline.OrganizationId,
                             TurnaroundId = turnaround.Id, turnaround.OperationDate,
                         }).SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : new OperationScope(row.Id, row.PublicId, row.OperationCode, row.CurrentStatus,
            row.StationId, row.IanaTimeZone, row.OrganizationId, row.TurnaroundId, row.OperationDate);
    }

    private async Task<OccIncidentData?> IncidentAsync(Guid incidentId, CancellationToken cancellationToken) =>
        (await IncidentsAsync([incidentId], cancellationToken)).SingleOrDefault();

    /// <summary>The incidents with their reporter, resolution, version, next states and history, in the given order.</summary>
    private async Task<IReadOnlyList<OccIncidentData>> IncidentsAsync(Guid[] incidentIds,
        CancellationToken cancellationToken)
    {
        if (incidentIds.Length == 0) return [];
        var rows = await (from incident in context.Incidents.AsNoTracking()
                          join agentRow in context.RampAgents.AsNoTracking()
                              on incident.ReportedByRampAgentId equals (long?)agentRow.Id into agents
                          from agent in agents.DefaultIfEmpty()
                          join personRow in context.Persons.AsNoTracking()
                              on agent!.PersonId equals personRow.Id into people
                          from person in people.DefaultIfEmpty()
                          where incidentIds.Contains(incident.PublicId)
                          select new
                          {
                              incident.Id, incident.PublicId, incident.IncidentType, incident.Severity, incident.Status,
                              incident.Description, incident.OccurredAt, incident.ReportedAt, incident.DelayCode,
                              incident.ReportedByAccountId, incident.ResolutionNote, incident.ResolvedAt,
                              incident.ResolvedByAccountId, incident.RowVersion,
                              AgentName = person == null ? null : person.FirstName + " " + person.LastName,
                          }).ToArrayAsync(cancellationToken);
        var internalIds = rows.Select(row => row.Id).ToArray();
        var events = (await context.Set<IncidentStatusEvent>().AsNoTracking()
                .Where(item => internalIds.Contains(item.IncidentId))
                .OrderBy(item => item.OccurredAt).ThenBy(item => item.Id)
                .Select(item => new { item.IncidentId, item.FromStatus, item.ToStatus, item.Note, item.OccurredAt,
                    item.ActorAccountId })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.IncidentId);
        var accounts = rows.SelectMany(row => new[] { row.ReportedByAccountId, row.ResolvedByAccountId })
            .Concat(events.SelectMany(group => group.Select(item => item.ActorAccountId)))
            .OfType<long>().ToArray();
        var names = await AccountDisplayNames.OfAsync(context, accounts, cancellationToken);
        string Name(long? accountId) => accountId is long id ? names.GetValueOrDefault(id, AccountDisplayNames.Unknown)
            : AccountDisplayNames.Unknown;
        var byId = rows.ToDictionary(row => row.PublicId);
        return incidentIds.Where(byId.ContainsKey).Select(id =>
        {
            var row = byId[id];
            var fromAgent = row.ReportedByAccountId is null;
            return new OccIncidentData(row.PublicId, row.IncidentType, row.Severity.ToString(), row.Status.ToString(),
                row.Description, row.OccurredAt, row.ReportedAt, row.DelayCode,
                fromAgent ? (row.AgentName?.Trim() is { Length: > 0 } agentName ? agentName : "Agente de rampa")
                    : Name(row.ReportedByAccountId),
                fromAgent ? "Agent" : "Occ", row.ResolutionNote, row.ResolvedAt,
                row.ResolvedByAccountId is null ? null : Name(row.ResolvedByAccountId),
                MasterDataCommand.Version(row.RowVersion),
                OccIncidentPolicy.NextStatuses(row.Status).Select(status => status.ToString()).ToArray(),
                events[row.Id].Select(item => new OccIncidentEventData(item.FromStatus?.ToString(), item.ToStatus.ToString(),
                    item.Note, item.OccurredAt, item.ActorAccountId is null ? "ELEVANT" : Name(item.ActorAccountId)))
                    .ToArray());
        }).ToArray();
    }

    private void Audit(OperationScope scope, long accountId, Incident incident, string action, string reason,
        DateTimeOffset now, object metadata) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = accountId, Action = action, EntityType = nameof(Incident), EntityPublicId = incident.PublicId,
            OrganizationId = scope.AirlineOrganizationId, StationId = scope.StationId, Source = AuditSource.Api,
            CorrelationId = Guid.CreateVersion7(), Reason = reason, MetadataJson = JsonSerializer.Serialize(metadata),
        });

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private DateTimeOffset Now() => Truncate(timeProvider.GetUtcNow());

    private static DateTimeOffset Truncate(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.UtcTicks - utc.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }
}
