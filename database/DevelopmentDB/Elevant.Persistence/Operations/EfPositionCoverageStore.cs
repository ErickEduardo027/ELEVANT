using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Position coverage per shift (ADR-0030). The rules live in <see cref="PositionCoveragePolicy"/>;
/// this store gathers the facts inside a serializable transaction, saves, audits and announces
/// <c>occ_planning</c> to OCC and <c>ramp_schedule</c> to the agent.
/// </summary>
internal sealed class EfPositionCoverageStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IPositionCoverageStore
{
    private const string ReadPermission = "operations.coverage.read";
    private const string AssignPermission = "operations.coverage.assign";
    private const string ConfigurePermission = "operations.coverage.update";

    /// <summary>Equipment type whose current qualification is the boarding-bridge qualification.</summary>
    public const string BridgeEquipmentTypeCode = "BOARDING-BRIDGE";

    private sealed record Scope(ActorContext Actor, long AccountId, long StationId, Guid StationPublicId, string StationCode,
        string TimeZone);

    public async Task<CoverageResult> ReadAsync(Guid actorId, Guid stationId, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        var (scope, failure) = await ScopeAsync(actorId, stationId, ReadPermission, cancellationToken);
        return scope is null ? CoverageResult.Fail(failure!.Value) : new(await BoardAsync(scope, date, cancellationToken), null, []);
    }

    public async Task<CoverageResult> CreateAsync(Guid actorId, Guid stationId, CreateCoverageInput input,
        CancellationToken cancellationToken = default)
    {
        var vehicle = input.VehicleCode?.Trim();
        var standIds = input.StandIds?.Distinct().ToArray() ?? [];
        if (vehicle is { Length: > 32 } || standIds.Length > 6 || standIds.Any(id => id == Guid.Empty) ||
            input.AgentId == Guid.Empty || input.TerminalId == Guid.Empty || input.MentorAgentId == input.AgentId ||
            (input.StartsAt is null) != (input.EndsAt is null))
            return CoverageResult.Fail(PositionCoverageFailure.Invalid);
        var (scope, failure) = await ScopeAsync(actorId, stationId, AssignPermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);

        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            context.ChangeTracker.Clear();
            await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                cancellationToken);
            var terminal = await context.Terminals.AsNoTracking()
                .Where(item => item.PublicId == input.TerminalId && item.StationId == scope.StationId && item.IsActive)
                .Select(item => new { item.Id, item.MaxStandsPerAgent, item.RequiresBridgeQualification })
                .SingleOrDefaultAsync(cancellationToken);
            var agent = await context.RampAgents.AsNoTracking().Where(item => item.PublicId == input.AgentId)
                .Select(item => new { item.Id, item.IsActive, item.HireDate }).SingleOrDefaultAsync(cancellationToken);
            var mentor = input.MentorAgentId is { } mentorId
                ? await context.RampAgents.AsNoTracking().Where(item => item.PublicId == mentorId)
                    .Select(item => new { item.Id, item.IsActive, item.HireDate }).SingleOrDefaultAsync(cancellationToken)
                : null;
            if (terminal is null || agent is null || (input.MentorAgentId is not null && mentor is null))
                return CoverageResult.Fail(PositionCoverageFailure.NotFound);
            var stands = await context.Stands.AsNoTracking()
                .Where(item => standIds.Contains(item.PublicId) && item.StationId == scope.StationId)
                .Select(item => new { item.Id, item.PublicId, item.Code, item.IsActive, item.TerminalId, item.HasBoardingBridge })
                .ToArrayAsync(cancellationToken);
            if (stands.Length != standIds.Length) return CoverageResult.Fail(PositionCoverageFailure.NotFound);

            var zone = TimeZoneInfo.FindSystemTimeZoneById(scope.TimeZone);
            var shift = await ShiftWindowAsync(agent.Id, scope.StationId, input.Date, zone, cancellationToken);
            var startsAt = Truncate(input.StartsAt ?? shift?.StartsAt ?? default);
            var endsAt = Truncate(input.EndsAt ?? shift?.EndsAt ?? default);
            if (shift is null && input.StartsAt is null)
                return CoverageResult.Fail(PositionCoverageFailure.Rejected, ["shift_not_covering"]);
            var mentorShift = mentor is null ? null : await ShiftWindowAsync(mentor.Id, scope.StationId, input.Date, zone,
                cancellationToken);

            var facts = await AgentFactsAsync([agent.Id], input.Date, cancellationToken);
            var standKeys = stands.Select(item => item.Id).ToArray();
            var active = context.Set<PositionCoverage>().AsNoTracking()
                .Where(item => item.ReleasedAt == null && item.StartsAt < endsAt && startsAt < item.EndsAt);
            var agentOverlap = await active.AnyAsync(item => item.RampAgentId == agent.Id, cancellationToken);
            var overlaps = await (from other in active
                                  join item in context.Set<PositionCoverageStand>().AsNoTracking()
                                      on other.Id equals item.PositionCoverageId
                                  join stand in context.Stands.AsNoTracking() on item.StandId equals stand.Id
                                  where standKeys.Contains(item.StandId) && other.RampAgentId != agent.Id
                                  select new { stand.PublicId, stand.Code, other.RampAgentId, other.MentorRampAgentId })
                .ToArrayAsync(cancellationToken);

            var candidate = new PositionCoverageCandidate(startsAt, endsAt, input.Date,
                new CoverageTerminalRules(terminal.MaxStandsPerAgent ?? PositionCoveragePolicy.DefaultMaxStandsPerAgent,
                    terminal.RequiresBridgeQualification),
                stands.Select(item => new CoverageStandFacts(item.PublicId, item.Code, item.IsActive,
                    item.TerminalId == terminal.Id, item.HasBoardingBridge)).ToArray(),
                new CoverageAgentFacts(agent.IsActive, agent.HireDate, facts.AirportPermit.Contains(agent.Id),
                    facts.DriverLicense.Contains(agent.Id), facts.BridgeQualified.Contains(agent.Id),
                    shift is not null && shift.StartsAt <= startsAt && endsAt <= shift.EndsAt,
                    facts.Absent.Contains(agent.Id), agentOverlap),
                mentor is null ? null : new CoverageMentorFacts(mentor.IsActive, mentor.HireDate,
                    mentorShift is not null && mentorShift.StartsAt <= startsAt && endsAt <= mentorShift.EndsAt),
                string.IsNullOrEmpty(vehicle) ? null : vehicle, input.IsReinforcement,
                overlaps.Select(item => new CoverageStandOverlap(item.PublicId, item.Code,
                    item.RampAgentId == mentor?.Id || item.MentorRampAgentId == agent.Id)).ToArray());
            var reasons = PositionCoveragePolicy.Evaluate(candidate);
            if (reasons.Count > 0) return CoverageResult.Fail(PositionCoverageFailure.Rejected, reasons);

            var now = Now();
            var coverage = new PositionCoverage
            {
                PublicId = Guid.CreateVersion7(), StationId = scope.StationId, TerminalId = terminal.Id, RampAgentId = agent.Id,
                MentorRampAgentId = mentor?.Id, VehicleCode = candidate.VehicleCode, IsReinforcement = input.IsReinforcement,
                StartsAt = startsAt, EndsAt = endsAt, AssignedByAccountId = scope.AccountId, CreatedAt = now, UpdatedAt = now,
            };
            context.Add(coverage);
            await context.SaveChangesAsync(cancellationToken);
            context.AddRange(stands.Select(item => new PositionCoverageStand { PositionCoverageId = coverage.Id, StandId = item.Id }));
            Audit(scope, "occ.coverage.assigned", nameof(PositionCoverage), coverage.PublicId, now, null, new
            {
                agentId = input.AgentId, stands = stands.Select(item => item.Code).ToArray(), startsAt, endsAt,
                mentorId = input.MentorAgentId, vehicle = candidate.VehicleCode, input.IsReinforcement,
            });
            await AnnounceAsync(scope, now, cancellationToken, agent.Id, mentor?.Id);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new CoverageResult(await BoardAsync(scope, input.Date, cancellationToken), null, []);
        });
    }

    public async Task<CoverageResult> ReleaseAsync(Guid actorId, Guid coverageId, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        var coverage = await context.Set<PositionCoverage>().SingleOrDefaultAsync(item => item.PublicId == coverageId,
            cancellationToken);
        if (coverage is null) return CoverageResult.Fail(PositionCoverageFailure.NotFound);
        var stationId = await context.Stations.AsNoTracking().Where(item => item.Id == coverage.StationId)
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        var (scope, failure) = await ScopeAsync(actorId, stationId, AssignPermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);
        if (coverage.ReleasedAt is null)
        {
            var now = Now();
            coverage.ReleasedAt = now < coverage.CreatedAt ? coverage.CreatedAt : now;
            coverage.ReleasedByAccountId = scope.AccountId;
            coverage.UpdatedAt = now;
            Audit(scope, "occ.coverage.released", nameof(PositionCoverage), coverage.PublicId, now, null, null);
            await AnnounceAsync(scope, now, cancellationToken, coverage.RampAgentId, coverage.MentorRampAgentId);
            if (!await SaveAsync(cancellationToken)) return CoverageResult.Fail(PositionCoverageFailure.Conflict);
        }
        return new CoverageResult(await BoardAsync(scope, date, cancellationToken), null, []);
    }

    public async Task<CoverageResult> UpdateStandAsync(Guid actorId, Guid standId, StandAttributesInput input, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        if (!TryParseSize(input.MaxAircraftSize, out var size)) return CoverageResult.Fail(PositionCoverageFailure.Invalid);
        var stand = await context.Stands.SingleOrDefaultAsync(item => item.PublicId == standId, cancellationToken);
        if (stand is null) return CoverageResult.Fail(PositionCoverageFailure.NotFound);
        var (scope, failure) = await ScopeForStationAsync(actorId, stand.StationId, ConfigurePermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);
        var now = Now();
        stand.HasBoardingBridge = input.HasBoardingBridge;
        stand.IsRemote = input.IsRemote;
        stand.MaxAircraftSize = size;
        stand.IsActive = input.IsActive;
        stand.UpdatedAt = now;
        Audit(scope, "occ.stand.configured", nameof(Stand), stand.PublicId, now, stand.Code, input);
        await AnnounceAsync(scope, now, cancellationToken);
        if (!await SaveAsync(cancellationToken)) return CoverageResult.Fail(PositionCoverageFailure.Conflict);
        return new CoverageResult(await BoardAsync(scope, date, cancellationToken), null, []);
    }

    public async Task<CoverageResult> UpdateTerminalAsync(Guid actorId, Guid terminalId, TerminalRulesInput input, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        if (input.MaxStandsPerAgent is < 1 or > 6) return CoverageResult.Fail(PositionCoverageFailure.Invalid);
        var terminal = await context.Terminals.SingleOrDefaultAsync(item => item.PublicId == terminalId, cancellationToken);
        if (terminal is null) return CoverageResult.Fail(PositionCoverageFailure.NotFound);
        var (scope, failure) = await ScopeForStationAsync(actorId, terminal.StationId, ConfigurePermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);
        var now = Now();
        terminal.MaxStandsPerAgent = input.MaxStandsPerAgent;
        terminal.RequiresBridgeQualification = input.RequiresBridgeQualification;
        terminal.UpdatedAt = now;
        Audit(scope, "occ.terminal.configured", nameof(Terminal), terminal.PublicId, now, terminal.Code, input);
        await AnnounceAsync(scope, now, cancellationToken);
        if (!await SaveAsync(cancellationToken)) return CoverageResult.Fail(PositionCoverageFailure.Conflict);
        return new CoverageResult(await BoardAsync(scope, date, cancellationToken), null, []);
    }

    public async Task<CoverageResult> AddConstraintAsync(Guid actorId, StandConstraintInput input, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        if (!Enum.TryParse<StandConstraintKind>(input.Kind, false, out var kind) || !Enum.IsDefined(kind) ||
            input.StandId == input.AffectedStandId)
            return CoverageResult.Fail(PositionCoverageFailure.Invalid);
        var stands = await context.Stands.AsNoTracking()
            .Where(item => item.PublicId == input.StandId || item.PublicId == input.AffectedStandId)
            .Select(item => new { item.Id, item.PublicId, item.StationId, item.Code }).ToArrayAsync(cancellationToken);
        var stand = stands.SingleOrDefault(item => item.PublicId == input.StandId);
        var affected = stands.SingleOrDefault(item => item.PublicId == input.AffectedStandId);
        if (stand is null || affected is null) return CoverageResult.Fail(PositionCoverageFailure.NotFound);
        if (stand.StationId != affected.StationId) return CoverageResult.Fail(PositionCoverageFailure.Invalid);
        var (scope, failure) = await ScopeForStationAsync(actorId, stand.StationId, ConfigurePermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);
        if (await context.Set<StandConstraint>().AnyAsync(item => item.IsActive && item.StandId == stand.Id &&
                item.AffectedStandId == affected.Id && item.Kind == kind, cancellationToken))
            return CoverageResult.Fail(PositionCoverageFailure.Conflict);
        var now = Now();
        var constraint = new StandConstraint
        {
            PublicId = Guid.CreateVersion7(), StationId = stand.StationId, StandId = stand.Id, AffectedStandId = affected.Id,
            Kind = kind, IsActive = true, CreatedByAccountId = scope.AccountId, CreatedAt = now, UpdatedAt = now,
        };
        context.Add(constraint);
        Audit(scope, "occ.stand_constraint.added", nameof(StandConstraint), constraint.PublicId, now,
            $"{stand.Code} → {affected.Code}", new { kind = kind.ToString() });
        await AnnounceAsync(scope, now, cancellationToken);
        if (!await SaveAsync(cancellationToken)) return CoverageResult.Fail(PositionCoverageFailure.Conflict);
        return new CoverageResult(await BoardAsync(scope, date, cancellationToken), null, []);
    }

    public async Task<CoverageResult> RemoveConstraintAsync(Guid actorId, Guid constraintId, DateOnly date,
        CancellationToken cancellationToken = default)
    {
        var constraint = await context.Set<StandConstraint>().SingleOrDefaultAsync(item => item.PublicId == constraintId,
            cancellationToken);
        if (constraint is null) return CoverageResult.Fail(PositionCoverageFailure.NotFound);
        var (scope, failure) = await ScopeForStationAsync(actorId, constraint.StationId, ConfigurePermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);
        if (constraint.IsActive)
        {
            var now = Now();
            constraint.IsActive = false;
            constraint.UpdatedAt = now;
            Audit(scope, "occ.stand_constraint.removed", nameof(StandConstraint), constraint.PublicId, now, null, null);
            await AnnounceAsync(scope, now, cancellationToken);
            if (!await SaveAsync(cancellationToken)) return CoverageResult.Fail(PositionCoverageFailure.Conflict);
        }
        return new CoverageResult(await BoardAsync(scope, date, cancellationToken), null, []);
    }

    public async Task<PositionCoverageFailure?> ReleaseOperationAgentAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken = default)
    {
        var target = await (from operation in context.GroundOperations
                            join turnaround in context.Turnarounds on operation.TurnaroundId equals turnaround.Id
                            join station in context.Stations on turnaround.StationId equals station.Id
                            where turnaround.PublicId == turnaroundId
                            select new { operation.Id, Station = station.PublicId, turnaround.AirlineId })
            .FirstOrDefaultAsync(cancellationToken);
        if (target is null) return PositionCoverageFailure.NotFound;
        var (scope, failure) = await ScopeAsync(actorId, target.Station, "operations.planning.assign", cancellationToken);
        if (scope is null) return failure;
        var operationRow = await context.GroundOperations.SingleAsync(item => item.Id == target.Id, cancellationToken);
        var open = await context.OperationAgentAssignments
            .Where(item => item.GroundOperationId == target.Id && item.ReleasedAt == null).ToArrayAsync(cancellationToken);
        // Only before the agent starts: afterwards the operation's evidence belongs to that agent.
        if (operationRow.CurrentStatus != GroundOperationStatus.Assigned || open.Length == 0)
            return PositionCoverageFailure.Conflict;
        var now = Now();
        foreach (var assignment in open)
        {
            assignment.ReleasedAt = now < assignment.AssignedAt ? assignment.AssignedAt : now;
            assignment.UpdatedAt = now;
            await OperationalNotificationWriter.NotifyAgentAsync(context, assignment.RampAgentId, scope.StationId, target.Id,
                assignment.PublicId, "assignment_released", now, cancellationToken);
        }
        operationRow.CurrentStatus = GroundOperationStatus.Planned;
        operationRow.UpdatedAt = now;
        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = target.Id, FromStatus = GroundOperationStatus.Assigned, ToStatus = GroundOperationStatus.Planned,
            OccurredAt = now, ActorAccountId = scope.AccountId, Reason = "Agent released from OCC planning.",
        });
        Audit(scope, "occ.operation.agent_released", nameof(GroundOperation), operationRow.PublicId, now, null, null);
        var organizationId = await context.Airlines.AsNoTracking().Where(item => item.Id == target.AirlineId)
            .Select(item => item.OrganizationId).SingleAsync(cancellationToken);
        await AirlineOperationChangeWriter.AddAsync(context, organizationId, operationRow.PublicId, now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, target.Id, now, false, cancellationToken,
            open.Select(item => item.RampAgentId).ToArray());
        return await SaveAsync(cancellationToken) ? null : PositionCoverageFailure.Conflict;
    }

    public async Task<IReadOnlyList<OwnCoverageData>?> ReadOwnAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor is null || !RampOperationsAccess.IsAuthorized(actor)) return null;
        var agents = await (from account in context.Users.AsNoTracking()
                            join agent in context.RampAgents.AsNoTracking() on account.PersonId equals agent.PersonId
                            where account.PublicId == accountId && agent.IsActive
                            select agent.Id).Take(2).ToArrayAsync(cancellationToken);
        if (agents.Length != 1) return null;
        var me = agents[0];
        var now = timeProvider.GetUtcNow();
        var until = now.AddHours(18);
        var rows = await (from coverage in context.Set<PositionCoverage>().AsNoTracking()
                          join station in context.Stations.AsNoTracking() on coverage.StationId equals station.Id
                          join terminal in context.Terminals.AsNoTracking() on coverage.TerminalId equals terminal.Id
                          where coverage.ReleasedAt == null && coverage.EndsAt > now && coverage.StartsAt < until &&
                                (coverage.RampAgentId == me || coverage.MentorRampAgentId == me)
                          orderby coverage.StartsAt
                          select new { coverage.Id, coverage.PublicId, Station = station.Code, Terminal = terminal.Code,
                              coverage.StartsAt, coverage.EndsAt, coverage.RampAgentId, coverage.MentorRampAgentId,
                              coverage.VehicleCode, coverage.IsReinforcement })
            .ToArrayAsync(cancellationToken);
        var ids = rows.Select(item => item.Id).ToArray();
        var standCodes = (await (from item in context.Set<PositionCoverageStand>().AsNoTracking()
                                 join stand in context.Stands.AsNoTracking() on item.StandId equals stand.Id
                                 where ids.Contains(item.PositionCoverageId)
                                 select new { item.PositionCoverageId, stand.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.PositionCoverageId, item => item.Code);
        var names = await NamesAsync(rows.SelectMany(item => new[] { item.RampAgentId, item.MentorRampAgentId ?? 0 })
            .Where(id => id != 0).Distinct().ToArray(), cancellationToken);
        return rows.Select(item => new OwnCoverageData(item.PublicId, item.Station, item.Terminal,
            standCodes[item.Id].Order(StringComparer.Ordinal).ToArray(), item.StartsAt, item.EndsAt,
            // A trainee sees their mentor; the mentor sees the trainee they accompany.
            item.RampAgentId == me ? (item.MentorRampAgentId is { } mentor ? names.GetValueOrDefault(mentor) : null)
                : names.GetValueOrDefault(item.RampAgentId),
            item.VehicleCode, item.IsReinforcement)).ToArray();
    }

    // ── Board ────────────────────────────────────────────────────────────────

    private async Task<CoverageBoardData> BoardAsync(Scope scope, DateOnly date, CancellationToken cancellationToken)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(scope.TimeZone);
        var dayStart = LocalToUtc(date.ToDateTime(TimeOnly.MinValue), zone);
        var dayEnd = LocalToUtc(date.AddDays(1).ToDateTime(TimeOnly.MinValue), zone);
        var terminals = await context.Terminals.AsNoTracking()
            .Where(item => item.StationId == scope.StationId && item.IsActive).OrderBy(item => item.Code)
            .Select(item => new { item.Id, item.PublicId, item.Code, item.Name, item.MaxStandsPerAgent,
                item.RequiresBridgeQualification })
            .ToArrayAsync(cancellationToken);
        var terminalById = terminals.ToDictionary(item => item.Id);
        var stands = await context.Stands.AsNoTracking().Where(item => item.StationId == scope.StationId)
            .OrderBy(item => item.Code)
            .Select(item => new { item.Id, item.PublicId, item.Code, item.TerminalId, item.IsActive, item.HasBoardingBridge,
                item.IsRemote, item.MaxAircraftSize })
            .ToArrayAsync(cancellationToken);
        var standById = stands.ToDictionary(item => item.Id);
        var constraints = await context.Set<StandConstraint>().AsNoTracking()
            .Where(item => item.StationId == scope.StationId && item.IsActive)
            .Select(item => new { item.PublicId, item.StandId, item.AffectedStandId, item.Kind })
            .ToArrayAsync(cancellationToken);
        var coverages = await context.Set<PositionCoverage>().AsNoTracking()
            .Where(item => item.StationId == scope.StationId && item.ReleasedAt == null &&
                           item.StartsAt < dayEnd && dayStart < item.EndsAt)
            .OrderBy(item => item.StartsAt)
            .Select(item => new { item.Id, item.PublicId, item.RampAgentId, item.MentorRampAgentId, item.TerminalId,
                item.StartsAt, item.EndsAt, item.VehicleCode, item.IsReinforcement })
            .ToArrayAsync(cancellationToken);
        var coverageIds = coverages.Select(item => item.Id).ToArray();
        var coverageStands = (await context.Set<PositionCoverageStand>().AsNoTracking()
                .Where(item => coverageIds.Contains(item.PositionCoverageId))
                .Select(item => new { item.PositionCoverageId, item.StandId }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.PositionCoverageId, item => item.StandId);

        var shifts = await (from shift in context.ShiftAssignments.AsNoTracking()
                            join agent in context.RampAgents.AsNoTracking() on shift.RampAgentId equals agent.Id
                            join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                            where shift.StationId == scope.StationId && shift.WorkDate == date && agent.IsActive
                            orderby person.FirstName, person.LastName, agent.PublicId
                            select new { agent.Id, agent.PublicId, agent.EmployeeNumber, agent.HireDate, shift.TerminalId,
                                shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal,
                                Name = (person.FirstName + " " + person.LastName).Trim() })
            .ToArrayAsync(cancellationToken);
        var agentIds = shifts.Select(item => item.Id).Distinct().ToArray();
        var facts = await AgentFactsAsync(agentIds, date, cancellationToken);
        var names = await NamesAsync(coverages.SelectMany(item => new[] { item.RampAgentId, item.MentorRampAgentId ?? 0 })
            .Where(id => id != 0).Distinct().ToArray(), cancellationToken);

        var coveredBy = coverages.SelectMany(item => coverageStands[item.Id].Select(standId => (standId, item.RampAgentId)))
            .ToLookup(pair => pair.standId, pair => names.GetValueOrDefault(pair.RampAgentId) ?? "—");
        var agents = shifts.Where(item => terminalById.ContainsKey(item.TerminalId)).Select(item =>
        {
            var (starts, ends) = ShiftUtc(item.WorkDate, item.StartsAtLocal, item.EndsAtLocal, zone);
            var terminal = terminalById[item.TerminalId];
            return new CoverageAgentData(item.PublicId, item.Name, item.EmployeeNumber, terminal.PublicId, terminal.Code,
                starts, ends, PositionCoveragePolicy.IsJunior(item.HireDate, date), facts.AirportPermit.Contains(item.Id),
                facts.DriverLicense.Contains(item.Id), facts.BridgeQualified.Contains(item.Id), facts.Absent.Contains(item.Id));
        }).ToArray();

        var access = scope.Actor;
        return new CoverageBoardData(scope.StationPublicId, scope.StationCode, date,
            terminals.Select(item => new CoverageTerminalData(item.PublicId, item.Code, item.Name,
                item.MaxStandsPerAgent ?? PositionCoveragePolicy.DefaultMaxStandsPerAgent, item.RequiresBridgeQualification)).ToArray(),
            stands.Select(item => new CoverageStandData(item.PublicId, item.Code,
                item.TerminalId is { } terminalId && terminalById.TryGetValue(terminalId, out var terminal) ? terminal.PublicId : null,
                item.IsActive, item.HasBoardingBridge, item.IsRemote, item.MaxAircraftSize?.ToString(),
                coveredBy[item.Id].Distinct().ToArray())).ToArray(),
            constraints.Where(item => standById.ContainsKey(item.StandId) && standById.ContainsKey(item.AffectedStandId))
                .Select(item => new StandConstraintData(item.PublicId, standById[item.StandId].PublicId,
                    standById[item.StandId].Code, standById[item.AffectedStandId].PublicId, standById[item.AffectedStandId].Code,
                    item.Kind.ToString())).ToArray(),
            agents,
            coverages.Where(item => terminalById.ContainsKey(item.TerminalId)).Select(item =>
            {
                var terminal = terminalById[item.TerminalId];
                var mentorId = item.MentorRampAgentId;
                return new CoverageData(item.PublicId, AgentPublicId(item.RampAgentId), names.GetValueOrDefault(item.RampAgentId) ?? "—",
                    terminal.PublicId, terminal.Code,
                    coverageStands[item.Id].Where(standById.ContainsKey)
                        .Select(standId => new CoverageStandRefData(standById[standId].PublicId, standById[standId].Code))
                        .OrderBy(stand => stand.Code, StringComparer.Ordinal).ToArray(),
                    item.StartsAt, item.EndsAt, mentorId is { } mentor ? AgentPublicId(mentor) : null,
                    mentorId is { } m ? names.GetValueOrDefault(m) : null, item.VehicleCode, item.IsReinforcement);
            }).ToArray(),
            Allowed(access, AssignPermission), Allowed(access, ConfigurePermission));

        Guid AgentPublicId(long id) => publicIds.GetValueOrDefault(id);
    }

    private Dictionary<long, Guid> publicIds = [];

    private sealed record AgentFacts(HashSet<long> AirportPermit, HashSet<long> DriverLicense, HashSet<long> BridgeQualified,
        HashSet<long> Absent);

    private async Task<AgentFacts> AgentFactsAsync(long[] agentIds, DateOnly date, CancellationToken cancellationToken)
    {
        var permits = await context.AirportPermitCycles.AsNoTracking()
            .Where(cycle => agentIds.Contains(cycle.RampAgentId) && cycle.IsCurrent && cycle.IssuedOn <= date &&
                            cycle.ExpiresOn >= date)
            .Select(cycle => new { cycle.RampAgentId, cycle.DocumentType }).Distinct().ToArrayAsync(cancellationToken);
        var bridge = await (from cycle in context.QualificationCycles.AsNoTracking()
                            join type in context.EquipmentTypes.AsNoTracking() on cycle.EquipmentTypeId equals type.Id
                            where agentIds.Contains(cycle.RampAgentId) && type.Code == BridgeEquipmentTypeCode &&
                                  cycle.IsCurrent && cycle.ObtainedOn <= date && cycle.ExpiresOn >= date
                            select cycle.RampAgentId).Distinct().ToArrayAsync(cancellationToken);
        var absent = await context.AvailabilityRequests.AsNoTracking()
            .Where(request => agentIds.Contains(request.RampAgentId) && request.Status == AvailabilityRequestStatus.Approved &&
                              (request.Type == AvailabilityRequestType.DayOff || request.Type == AvailabilityRequestType.Restriction) &&
                              request.StartsOn <= date && request.EndsOn >= date)
            .Select(request => request.RampAgentId).Distinct().ToArrayAsync(cancellationToken);
        return new AgentFacts(
            permits.Where(item => item.DocumentType == PermitDocumentType.AirportId).Select(item => item.RampAgentId).ToHashSet(),
            permits.Where(item => item.DocumentType == PermitDocumentType.RampDriverLicense).Select(item => item.RampAgentId).ToHashSet(),
            bridge.ToHashSet(), absent.ToHashSet());
    }

    private sealed record Window(DateTimeOffset StartsAt, DateTimeOffset EndsAt);

    private async Task<Window?> ShiftWindowAsync(long agentId, long stationId, DateOnly date, TimeZoneInfo zone,
        CancellationToken cancellationToken)
    {
        var shift = await context.ShiftAssignments.AsNoTracking()
            .Where(item => item.RampAgentId == agentId && item.StationId == stationId && item.WorkDate == date)
            .Select(item => new { item.WorkDate, item.StartsAtLocal, item.EndsAtLocal }).SingleOrDefaultAsync(cancellationToken);
        if (shift is null) return null;
        var (starts, ends) = ShiftUtc(shift.WorkDate, shift.StartsAtLocal, shift.EndsAtLocal, zone);
        return new Window(starts, ends);
    }

    /// <summary>The shift as UTC instants; an end before the start crosses midnight.</summary>
    private static (DateTimeOffset Starts, DateTimeOffset Ends) ShiftUtc(DateOnly workDate, TimeOnly startsAt, TimeOnly endsAt,
        TimeZoneInfo zone)
    {
        var start = workDate.ToDateTime(startsAt);
        var end = (endsAt <= startsAt ? workDate.AddDays(1) : workDate).ToDateTime(endsAt);
        return (LocalToUtc(start, zone), LocalToUtc(end, zone));
    }

    private static DateTimeOffset LocalToUtc(DateTime local, TimeZoneInfo zone) =>
        new(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone), TimeSpan.Zero);

    private async Task<Dictionary<long, string>> NamesAsync(long[] agentIds, CancellationToken cancellationToken)
    {
        var rows = await (from agent in context.RampAgents.AsNoTracking()
                          join person in context.Persons.AsNoTracking() on agent.PersonId equals person.Id
                          where agentIds.Contains(agent.Id)
                          select new { agent.Id, agent.PublicId, Name = (person.FirstName + " " + person.LastName).Trim() })
            .ToArrayAsync(cancellationToken);
        foreach (var row in rows) publicIds[row.Id] = row.PublicId;
        return rows.ToDictionary(row => row.Id, row => row.Name);
    }

    // ── Shared ───────────────────────────────────────────────────────────────

    private async Task<(Scope? Scope, PositionCoverageFailure? Failure)> ScopeAsync(Guid actorId, Guid stationId,
        string permission, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, permission)) return (null, PositionCoverageFailure.Forbidden);
        if (!actor!.StationScopes.Any(scope => scope.StationId == stationId)) return (null, PositionCoverageFailure.NotFound);
        var station = await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
            .Select(item => new { item.Id, item.Code, item.IanaTimeZone }).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return (null, PositionCoverageFailure.NotFound);
        var accountId = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        return (new Scope(actor, accountId, station.Id, stationId, station.Code, station.IanaTimeZone), null);
    }

    private async Task<(Scope? Scope, PositionCoverageFailure? Failure)> ScopeForStationAsync(Guid actorId, long stationId,
        string permission, CancellationToken cancellationToken)
    {
        var publicId = await context.Stations.AsNoTracking().Where(item => item.Id == stationId)
            .Select(item => item.PublicId).SingleAsync(cancellationToken);
        return await ScopeAsync(actorId, publicId, permission, cancellationToken);
    }

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private static bool TryParseSize(string? value, out AircraftSizeCategory? size)
    {
        size = null;
        if (value is null) return true;
        if (!Enum.TryParse<AircraftSizeCategory>(value, false, out var parsed) || !Enum.IsDefined(parsed)) return false;
        size = parsed;
        return true;
    }

    private void Audit(Scope scope, string action, string entityType, Guid entityId, DateTimeOffset now, string? reason,
        object? metadata) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = scope.AccountId, Action = action, EntityType = entityType, EntityPublicId = entityId,
            StationId = scope.StationId, Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(), Reason = reason,
            MetadataJson = metadata is null ? null : JsonSerializer.Serialize(metadata),
        });

    private async Task AnnounceAsync(Scope scope, DateTimeOffset now, CancellationToken cancellationToken,
        params long?[] agentIds)
    {
        await OccPlanningChangeWriter.AddForStationAsync(context, scope.StationId, scope.StationPublicId, now, cancellationToken);
        foreach (var agentId in agentIds.OfType<long>().Distinct())
            await RampOperationChangeWriter.AnnounceScheduleAsync(context, agentId, scope.StationPublicId, now, cancellationToken);
    }

    private async Task<bool> SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return false;
        }
    }

    private DateTimeOffset Now() => Truncate(timeProvider.GetUtcNow());

    private static DateTimeOffset Truncate(DateTimeOffset value) =>
        new(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
}
