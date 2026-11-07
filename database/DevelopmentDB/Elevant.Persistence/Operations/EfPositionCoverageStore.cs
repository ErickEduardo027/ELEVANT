using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

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
    private const string PlanningAssignPermission = "operations.planning.assign";

    // Receipts of the Idempotency-Key (3-J, 3-F): one action per command.
    private const string CreateAction = "occ.coverage.create";
    private const string ReleaseAction = "occ.coverage.release";
    private const string AgentReleaseAction = "occ.operation.release_agent";
    private const string HandoverAction = "occ.operation.handover";

    /// <summary>The audit of a handover (3-F); it names both agents and the reason.</summary>
    public const string HandedOverAuditAction = "occ.operation.handed_over";

    // Problem Details codes (packages/api-client/src/errors.ts).
    private const string NotFoundCode = "not_found";
    private const string VersionConflictCode = "version_conflict";
    private const string IdempotencyConflictCode = "idempotency_conflict";
    private const string IdempotencyKeyRequiredCode = "idempotency_key_required";
    private const string ExpectedVersionRequiredCode = "expected_version_required";
    private const string ReasonRequiredCode = "reason_required";
    public const string AssignmentChangedCode = "assignment_changed";
    public const string OperationStartedCode = "operation_started";
    public const string HandoverNotAllowedCode = "handover_not_allowed";
    public const string SameAgentCode = "same_agent";
    public const string AgentNotEligibleCode = "agent_not_eligible";
    public const string InvalidHandoverCode = "invalid_handover";

    /// <summary>A late operation still has this much left for the agent who takes it (3-F).</summary>
    private static readonly TimeSpan MinimumRemaining = TimeSpan.FromMinutes(15);

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
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        // 3-J: the key is optional while older clients exist (expand); an empty one is never a key.
        if (idempotencyKey == Guid.Empty)
            return CoverageResult.Fail(PositionCoverageFailure.Invalid, null, IdempotencyKeyRequiredCode);
        var vehicle = input.VehicleCode?.Trim();
        var standIds = input.StandIds?.Distinct().ToArray() ?? [];
        if (vehicle is { Length: > 32 } || standIds.Length > 6 || standIds.Any(id => id == Guid.Empty) ||
            input.AgentId == Guid.Empty || input.TerminalId == Guid.Empty || input.MentorAgentId == input.AgentId ||
            (input.StartsAt is null) != (input.EndsAt is null))
            return CoverageResult.Fail(PositionCoverageFailure.Invalid);
        var (scope, failure) = await ScopeAsync(actorId, stationId, AssignPermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);
        // The normalized body: the stands in a fixed order, the instants in milliseconds, never the key.
        var hash = CommercialCommandReceipts.Hash(new
        {
            stationId, input.AgentId, input.TerminalId, standIds = standIds.Order().ToArray(), input.Date,
            startsAt = input.StartsAt is { } starting ? Truncate(starting) : (DateTimeOffset?)null,
            endsAt = input.EndsAt is { } ending ? Truncate(ending) : (DateTimeOffset?)null,
            input.MentorAgentId, vehicle = string.IsNullOrEmpty(vehicle) ? null : vehicle, input.IsReinforcement,
        });

        return await CommandAsync(idempotencyKey, scope.AccountId, CreateAction, hash,
            () => BoardAsync(scope, input.Date, cancellationToken), async () =>
        {
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
                return (CoverageResult.Fail(PositionCoverageFailure.NotFound), Guid.Empty);
            var stands = await context.Stands.AsNoTracking()
                .Where(item => standIds.Contains(item.PublicId) && item.StationId == scope.StationId)
                .Select(item => new { item.Id, item.PublicId, item.Code, item.IsActive, item.TerminalId, item.HasBoardingBridge })
                .ToArrayAsync(cancellationToken);
            if (stands.Length != standIds.Length) return (CoverageResult.Fail(PositionCoverageFailure.NotFound), Guid.Empty);

            var zone = BusinessCalendar.Zone(scope.TimeZone);
            var shift = await ShiftWindowAsync(agent.Id, scope.StationId, input.Date, zone, cancellationToken);
            var startsAt = Truncate(input.StartsAt ?? shift?.StartsAt ?? default);
            var endsAt = Truncate(input.EndsAt ?? shift?.EndsAt ?? default);
            if (shift is null && input.StartsAt is null)
                return (CoverageResult.Fail(PositionCoverageFailure.Rejected, ["shift_not_covering"]), Guid.Empty);
            var mentorShift = mentor is null ? null : await ShiftWindowAsync(mentor.Id, scope.StationId, input.Date, zone,
                cancellationToken);

            // 2-N23: the mentor's absence and airport permit count as much as the agent's. 3-N05: the documents stay
            // current until the local day the coverage ends (a night shift ends the next day).
            var lastDay = endsAt > startsAt ? BusinessCalendar.Today(endsAt.AddMilliseconds(-1), scope.TimeZone) : input.Date;
            var facts = await AgentFactsAsync(mentor is null ? [agent.Id] : [agent.Id, mentor.Id], input.Date,
                cancellationToken, lastDay > input.Date ? lastDay : input.Date);
            // 3-N05: the tablet works a stand only with a current scope in its terminal.
            var terminalScope = await context.Set<RampAgentTerminalScope>().AsNoTracking().AnyAsync(item =>
                item.RampAgentId == agent.Id && item.TerminalId == terminal.Id && item.ValidFrom <= input.Date &&
                (item.ValidTo == null || item.ValidTo >= input.Date), cancellationToken);
            var standKeys = stands.Select(item => item.Id).ToArray();
            var active = context.Set<PositionCoverage>().AsNoTracking()
                .Where(item => item.ReleasedAt == null && item.StartsAt < endsAt && startsAt < item.EndsAt);
            var agentOverlap = await active.AnyAsync(item => item.RampAgentId == agent.Id, cancellationToken);
            // A coverage left open by an agent who no longer works the ramp takes no stand (2-N06, legacy rows).
            var overlaps = await (from other in active
                                  join item in context.Set<PositionCoverageStand>().AsNoTracking()
                                      on other.Id equals item.PositionCoverageId
                                  join stand in context.Stands.AsNoTracking() on item.StandId equals stand.Id
                                  join holder in context.RampAgents.AsNoTracking() on other.RampAgentId equals holder.Id
                                  where standKeys.Contains(item.StandId) && other.RampAgentId != agent.Id && holder.IsActive
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
                    facts.Absent.Contains(agent.Id), agentOverlap, terminalScope),
                mentor is null ? null : new CoverageMentorFacts(mentor.IsActive, mentor.HireDate,
                    mentorShift is not null && mentorShift.StartsAt <= startsAt && endsAt <= mentorShift.EndsAt,
                    facts.Absent.Contains(mentor.Id), facts.AirportPermit.Contains(mentor.Id)),
                string.IsNullOrEmpty(vehicle) ? null : vehicle, input.IsReinforcement,
                overlaps.Select(item => new CoverageStandOverlap(item.PublicId, item.Code,
                    item.RampAgentId == mentor?.Id || item.MentorRampAgentId == agent.Id)).ToArray());
            var reasons = PositionCoveragePolicy.Evaluate(candidate);
            if (reasons.Count > 0) return (CoverageResult.Fail(PositionCoverageFailure.Rejected, reasons), Guid.Empty);

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
            return ((CoverageResult?)null, coverage.PublicId);
        }, cancellationToken);
    }

    public async Task<CoverageResult> ReleaseAsync(Guid actorId, Guid coverageId, DateOnly date, Guid? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (idempotencyKey == Guid.Empty)
            return CoverageResult.Fail(PositionCoverageFailure.Invalid, null, IdempotencyKeyRequiredCode);
        var station = await (from item in context.Set<PositionCoverage>().AsNoTracking()
                             join owner in context.Stations.AsNoTracking() on item.StationId equals owner.Id
                             where item.PublicId == coverageId
                             select (Guid?)owner.PublicId).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return CoverageResult.Fail(PositionCoverageFailure.NotFound);
        var (scope, failure) = await ScopeAsync(actorId, station.Value, AssignPermission, cancellationToken);
        if (scope is null) return CoverageResult.Fail(failure!.Value);
        var hash = CommercialCommandReceipts.Hash(new { coverageId, date });

        return await CommandAsync(idempotencyKey, scope.AccountId, ReleaseAction, hash,
            () => BoardAsync(scope, date, cancellationToken), async () =>
        {
            var coverage = await context.Set<PositionCoverage>().SingleAsync(item => item.PublicId == coverageId,
                cancellationToken);
            // Releasing twice answers the board: the coverage is released once.
            if (coverage.ReleasedAt is null)
            {
                var now = Now();
                coverage.ReleasedAt = now < coverage.CreatedAt ? coverage.CreatedAt : now;
                coverage.ReleasedByAccountId = scope.AccountId;
                coverage.UpdatedAt = now;
                Audit(scope, "occ.coverage.released", nameof(PositionCoverage), coverage.PublicId, now, null, null);
                await AnnounceAsync(scope, now, cancellationToken, coverage.RampAgentId, coverage.MentorRampAgentId);
            }
            return ((CoverageResult?)null, coverage.PublicId);
        }, cancellationToken);
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
        // A stand in use is never deactivated, from this screen either (2-A): the rule goes back as the reason.
        if (stand.IsActive && !input.IsActive && await MasterDataUsage.StandInUseAsync(context, stand.Id,
                MasterDataUsage.Since(BusinessCalendar.Today(now, scope.TimeZone)), now, cancellationToken))
            return CoverageResult.Fail(PositionCoverageFailure.Rejected, ["stand_in_use"], "stand_in_use");
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

    public async Task<OperationAgentCommandResult> ReleaseOperationAgentAsync(Guid actorId, Guid turnaroundId,
        ReleaseOperationAgentInput input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        // 3-J, expand: the key and the assignment OCC saw are optional for older clients; a key needs the assignment.
        if (input.IdempotencyKey == Guid.Empty)
            return OperationAgentCommandResult.Fail(PositionCoverageFailure.Invalid, IdempotencyKeyRequiredCode);
        if (input.ExpectedAssignmentId == Guid.Empty || (input.IdempotencyKey is not null && input.ExpectedAssignmentId is null))
            return OperationAgentCommandResult.Fail(PositionCoverageFailure.Invalid, ExpectedVersionRequiredCode);
        var target = await TargetAsync(turnaroundId, cancellationToken);
        if (target is null) return OperationAgentCommandResult.Fail(PositionCoverageFailure.NotFound, NotFoundCode);
        var (scope, failure) = await ScopeAsync(actorId, target.StationPublicId, PlanningAssignPermission, cancellationToken);
        if (scope is null)
            return new OperationAgentCommandResult(failure, failure == PositionCoverageFailure.NotFound ? NotFoundCode : null);
        var key = input.IdempotencyKey;
        var hash = CommercialCommandReceipts.Hash(new { turnaroundId, expectedAssignmentId = input.ExpectedAssignmentId });
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                if (key is { } receipt)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, receipt, scope.AccountId, AgentReleaseAction,
                        hash, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return OperationAgentCommandResult.Fail(PositionCoverageFailure.Conflict, IdempotencyConflictCode);
                    // The same intent answered again: the agent was released by its first attempt.
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return OperationAgentCommandResult.Done;
                }
                var operation = await LockOperationAsync(target.OperationId, cancellationToken);
                var open = await context.OperationAgentAssignments
                    .Where(item => item.GroundOperationId == operation.Id && item.ReleasedAt == null)
                    .ToArrayAsync(cancellationToken);
                // Another agent than the one OCC saw holds it now: the screen reads it again before a new intent.
                if (input.ExpectedAssignmentId is { } expected && !open.Any(item => item.PublicId == expected))
                    return OperationAgentCommandResult.Fail(PositionCoverageFailure.Conflict, AssignmentChangedCode);
                // Only before the agent starts: afterwards the evidence is the agent's, and OCC hands it over (3-F).
                if (Started(operation))
                    return OperationAgentCommandResult.Fail(PositionCoverageFailure.Conflict, OperationStartedCode);
                if (operation.CurrentStatus != GroundOperationStatus.Assigned || open.Length == 0)
                    return OperationAgentCommandResult.Fail(PositionCoverageFailure.Conflict, AssignmentChangedCode);
                var now = Now();
                // The one release path (RampAgentRelease): back to Planned, the tablet hears «assignment_released».
                await RampAgentRelease.ReleaseOperationAsync(context, operation, open, scope.StationId, target.AirlineId,
                    scope.AccountId, "OCC lo liberó desde Planificación", "occ.operation.agent_released", null,
                    key ?? Guid.CreateVersion7(), now, cancellationToken);
                if (key is { } done)
                    CommercialCommandReceipts.Add(context, done, scope.AccountId, AgentReleaseAction, hash, open[0].PublicId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return OperationAgentCommandResult.Done;
            });
        }
        catch (DbUpdateException exception) when (key is { } receipt && CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent attempt of the same intent committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, receipt, scope.AccountId, AgentReleaseAction,
                hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? OperationAgentCommandResult.Done
                : OperationAgentCommandResult.Fail(PositionCoverageFailure.Conflict, IdempotencyConflictCode);
        }
        catch (Exception exception) when (IsConcurrentWrite(exception))
        {
            context.ChangeTracker.Clear();
            return OperationAgentCommandResult.Fail(PositionCoverageFailure.Conflict, VersionConflictCode);
        }
    }

    public async Task<OccHandoverResult<OccHandoverOptionsData>> ReadHandoverOptionsAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken = default)
    {
        var target = await TargetAsync(turnaroundId, cancellationToken);
        if (target is null) return OccHandoverResult<OccHandoverOptionsData>.Fail(PositionCoverageFailure.NotFound, NotFoundCode);
        var (scope, failure) = await ScopeAsync(actorId, target.StationPublicId, PlanningAssignPermission, cancellationToken);
        if (scope is null)
            return new(null, failure, failure == PositionCoverageFailure.NotFound ? NotFoundCode : null);
        var operation = await context.GroundOperations.AsNoTracking()
            .SingleAsync(item => item.Id == target.OperationId, cancellationToken);
        var open = await context.OperationAgentAssignments.AsNoTracking()
            .Where(item => item.GroundOperationId == operation.Id && item.ReleasedAt == null)
            .ToArrayAsync(cancellationToken);
        if (!CanHandOver(operation.CurrentStatus) || open.Length != 1)
            return OccHandoverResult<OccHandoverOptionsData>.Fail(PositionCoverageFailure.Conflict, HandoverNotAllowedCode);
        var current = open[0];
        var (from, until) = RemainingWindow(operation);
        var candidates = await HandoverCandidatesAsync(target, operation, from, until, null, cancellationToken);
        var names = await NamesAsync([current.RampAgentId], cancellationToken);
        return OccHandoverResult<OccHandoverOptionsData>.Success(new OccHandoverOptionsData(target.TurnaroundPublicId,
            operation.PublicId, operation.CurrentStatus.ToString(), current.PublicId, publicIds[current.RampAgentId],
            names.GetValueOrDefault(current.RampAgentId) ?? "—", from, until,
            candidates.Where(candidate => candidate.AgentId != current.RampAgentId)
                .Select(candidate => OccAgentEligibilityPolicy.Evaluate(candidate.Data)).ToArray()));
    }

    public async Task<OccHandoverResult<OccOperationHandoverData>> HandOverOperationAsync(Guid actorId, Guid turnaroundId,
        HandOverOperationInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        // A new command (3-F): the key, the assignment OCC saw and the reason are required.
        if (idempotencyKey is not { } key || key == Guid.Empty)
            return HandoverFail(PositionCoverageFailure.Invalid, IdempotencyKeyRequiredCode);
        if (input is null || input.AgentId == Guid.Empty)
            return HandoverFail(PositionCoverageFailure.Invalid, InvalidHandoverCode);
        if (input.ExpectedAssignmentId == Guid.Empty)
            return HandoverFail(PositionCoverageFailure.Invalid, ExpectedVersionRequiredCode);
        var reason = input.Reason?.Trim();
        if (reason is not { Length: >= 5 and <= 500 })
            return HandoverFail(PositionCoverageFailure.Invalid, ReasonRequiredCode);
        var target = await TargetAsync(turnaroundId, cancellationToken);
        if (target is null) return HandoverFail(PositionCoverageFailure.NotFound, NotFoundCode);
        var (scope, failure) = await ScopeAsync(actorId, target.StationPublicId, PlanningAssignPermission, cancellationToken);
        if (scope is null)
            return new(null, failure, failure == PositionCoverageFailure.NotFound ? NotFoundCode : null);
        var hash = CommercialCommandReceipts.Hash(new
        {
            turnaroundId, input.AgentId, input.ExpectedAssignmentId, reason,
        });
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var prior = await CommercialCommandReceipts.FindAsync(context, key, scope.AccountId, HandoverAction, hash,
                    cancellationToken);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                    return HandoverFail(PositionCoverageFailure.Conflict, IdempotencyConflictCode);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                    return await HandedOverAsync(target, prior.ResultId, input.ExpectedAssignmentId, cancellationToken);

                // The operation and the agent who takes it are locked: a concurrent handover or assignment waits.
                var operation = await LockOperationAsync(target.OperationId, cancellationToken);
                var newAgent = await context.RampAgents
                    .FromSqlInterpolated($"""
                        SELECT * FROM [hr].[ramp_agents] WITH (UPDLOCK, HOLDLOCK)
                        WHERE [public_id] = {input.AgentId}
                        """)
                    .AsNoTracking().Select(item => new { item.Id, item.PublicId }).SingleOrDefaultAsync(cancellationToken);
                if (!CanHandOver(operation.CurrentStatus))
                    return HandoverFail(PositionCoverageFailure.Conflict, HandoverNotAllowedCode);
                var open = await context.OperationAgentAssignments
                    .Where(item => item.GroundOperationId == operation.Id && item.ReleasedAt == null)
                    .ToArrayAsync(cancellationToken);
                if (open.Length != 1 || open[0].PublicId != input.ExpectedAssignmentId)
                    return HandoverFail(PositionCoverageFailure.Conflict, AssignmentChangedCode);
                var previous = open[0];
                if (newAgent is null) return HandoverFail(PositionCoverageFailure.Conflict, AgentNotEligibleCode);
                if (newAgent.Id == previous.RampAgentId) return HandoverFail(PositionCoverageFailure.Invalid, SameAgentCode);

                // The manual assignment's rules over what is left of the operation: documents on its date, the terminal
                // of its stand, a shift there now, absences, mobile account, mentor and the three simultaneous operations.
                var (from, until) = RemainingWindow(operation);
                var candidate = (await HandoverCandidatesAsync(target, operation, from, until, [newAgent.Id],
                    cancellationToken)).SingleOrDefault();
                if (candidate is null || !OccAgentEligibilityPolicy.Evaluate(candidate.Data).Eligible ||
                    candidate.Data.OperationalPositionId is not { } positionPublicId)
                    return HandoverFail(PositionCoverageFailure.Conflict, AgentNotEligibleCode);
                var positionId = await context.OperationalPositions.AsNoTracking()
                    .Where(item => item.PublicId == positionPublicId).Select(item => (long?)item.Id)
                    .SingleOrDefaultAsync(cancellationToken);
                var now = Now();
                var assignment = await RampAgentRelease.ReplaceAgentAsync(context, operation, previous, newAgent.Id, positionId,
                    scope.StationId, target.AirlineId, scope.AccountId, reason, HandedOverAuditAction, key, now,
                    cancellationToken);
                CommercialCommandReceipts.Add(context, key, scope.AccountId, HandoverAction, hash, assignment.PublicId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                var previousAgent = await context.RampAgents.AsNoTracking().Where(item => item.Id == previous.RampAgentId)
                    .Select(item => item.PublicId).SingleAsync(cancellationToken);
                return OccHandoverResult<OccOperationHandoverData>.Success(new OccOperationHandoverData(
                    target.TurnaroundPublicId, assignment.PublicId, newAgent.PublicId, previousAgent, false));
            });
        }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, scope.AccountId, HandoverAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await HandedOverAsync(target, concurrent.ResultId, input.ExpectedAssignmentId, cancellationToken)
                : HandoverFail(PositionCoverageFailure.Conflict, IdempotencyConflictCode);
        }
        catch (Exception exception) when (IsConcurrentWrite(exception))
        {
            context.ChangeTracker.Clear();
            return HandoverFail(PositionCoverageFailure.Conflict, VersionConflictCode);
        }
    }

    /// <summary>The handover a key already answered, as it was: the new assignment and the agent it replaced.</summary>
    private async Task<OccHandoverResult<OccOperationHandoverData>> HandedOverAsync(OperationTarget target, Guid assignmentId,
        Guid previousAssignmentId, CancellationToken cancellationToken)
    {
        var agents = await (from assignment in context.OperationAgentAssignments.AsNoTracking()
                            join agent in context.RampAgents.AsNoTracking() on assignment.RampAgentId equals agent.Id
                            where assignment.PublicId == assignmentId || assignment.PublicId == previousAssignmentId
                            select new { assignment.PublicId, Agent = agent.PublicId })
            .ToDictionaryAsync(item => item.PublicId, item => item.Agent, cancellationToken);
        return agents.TryGetValue(assignmentId, out var agentId) && agents.TryGetValue(previousAssignmentId, out var previous)
            ? OccHandoverResult<OccOperationHandoverData>.Success(new OccOperationHandoverData(target.TurnaroundPublicId,
                assignmentId, agentId, previous, true))
            : HandoverFail(PositionCoverageFailure.Conflict, AssignmentChangedCode);
    }

    private static OccHandoverResult<OccOperationHandoverData> HandoverFail(PositionCoverageFailure failure, string code) =>
        OccHandoverResult<OccOperationHandoverData>.Fail(failure, code);

    /// <summary>3-F: OCC hands over an operation its agent already started, or one returned for correction.</summary>
    private static bool CanHandOver(GroundOperationStatus status) =>
        status is GroundOperationStatus.InProgress or GroundOperationStatus.Returned;

    /// <summary>The agent started it, or it already went further: its evidence is the agent's.</summary>
    private static bool Started(GroundOperation operation) =>
        OperationOccupancyRules.HasStarted(operation.ActualStartAt) ||
        operation.CurrentStatus is GroundOperationStatus.InProgress or GroundOperationStatus.Returned or
            GroundOperationStatus.PendingReview or GroundOperationStatus.InReview or GroundOperationStatus.Approved;

    /// <summary>
    /// What is left of an operation from now (3-F): from now, or its planned start if that comes later, to its planned
    /// end, never shorter than <see cref="MinimumRemaining"/> (an operation running late still needs an agent).
    /// </summary>
    private (DateTimeOffset From, DateTimeOffset Until) RemainingWindow(GroundOperation operation)
    {
        var now = Now();
        var from = operation.PlannedStartAt is { } start && start > now ? start : now;
        var until = operation.PlannedEndAt is { } end && end > from + MinimumRemaining ? end : from + MinimumRemaining;
        return (from, until);
    }

    /// <summary>The agents OCC's eligibility evaluates for the rest of the operation, at the terminal of its stand.</summary>
    private async Task<EfOccPlanningReadStore.AgentCandidate[]> HandoverCandidatesAsync(OperationTarget target,
        GroundOperation operation, DateTimeOffset from, DateTimeOffset until, IReadOnlyCollection<long>? onlyAgentIds,
        CancellationToken cancellationToken)
    {
        var terminalId = await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                                join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                                where assignment.TurnaroundId == target.TurnaroundId && assignment.AssignedTo == null
                                select stand.TerminalId).FirstOrDefaultAsync(cancellationToken);
        return await new EfOccPlanningReadStore(context, timeProvider).BuildAgentCandidatesAsync(operation.Id,
            target.StationId, terminalId, target.OperationDate, from, from, until, target.TimeZone, onlyAgentIds,
            cancellationToken);
    }

    private sealed record OperationTarget(long OperationId, long TurnaroundId, Guid TurnaroundPublicId, Guid StationPublicId,
        long StationId, long AirlineId, DateOnly OperationDate, string TimeZone);

    /// <summary>The operation of a turnaround with its station, read before the transaction to resolve the actor's scope.</summary>
    private Task<OperationTarget?> TargetAsync(Guid turnaroundId, CancellationToken cancellationToken) =>
        (from operation in context.GroundOperations.AsNoTracking()
         join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
         join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
         where turnaround.PublicId == turnaroundId
         select new OperationTarget(operation.Id, turnaround.Id, turnaround.PublicId, station.PublicId, station.Id,
             turnaround.AirlineId, turnaround.OperationDate, station.IanaTimeZone))
        .FirstOrDefaultAsync(cancellationToken);

    /// <summary>The operation, locked for this transaction: a concurrent command on it waits and then sees this one.</summary>
    private Task<GroundOperation> LockOperationAsync(long operationId, CancellationToken cancellationToken) =>
        context.GroundOperations
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [id] = {operationId}
                """)
            .SingleAsync(cancellationToken);

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

    /// <summary>
    /// The documents current on <paramref name="date"/> and still on <paramref name="untilDate"/> (the local day a night
    /// coverage ends, 3-N05; the same day by default), and the approved absences of <paramref name="date"/>.
    /// </summary>
    private async Task<AgentFacts> AgentFactsAsync(long[] agentIds, DateOnly date, CancellationToken cancellationToken,
        DateOnly? untilDate = null)
    {
        var until = untilDate is { } last && last > date ? last : date;
        var permits = await context.AirportPermitCycles.AsNoTracking()
            .Where(cycle => agentIds.Contains(cycle.RampAgentId) && cycle.IsCurrent && cycle.IssuedOn <= date &&
                            cycle.ExpiresOn >= until)
            .Select(cycle => new { cycle.RampAgentId, cycle.DocumentType }).Distinct().ToArrayAsync(cancellationToken);
        var bridge = await (from cycle in context.QualificationCycles.AsNoTracking()
                            join type in context.EquipmentTypes.AsNoTracking() on cycle.EquipmentTypeId equals type.Id
                            where agentIds.Contains(cycle.RampAgentId) && type.Code == BridgeEquipmentTypeCode &&
                                  cycle.IsCurrent && cycle.ObtainedOn <= date && cycle.ExpiresOn >= until
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

    /// <summary>
    /// One coverage command (3-J) in a serializable transaction, like the master-data commands: the Idempotency-Key's
    /// receipt when the client sent one, the work, the receipt and the commit (<see cref="CommercialCommandReceipts"/>).
    /// A replay answers the board again without repeating the audit or the announcements; the key with another body is
    /// <c>idempotency_conflict</c>; a deadlock or a concurrent write is <c>version_conflict</c> and the screen re-reads.
    /// </summary>
    private async Task<CoverageResult> CommandAsync(Guid? key, long accountId, string action, string hash,
        Func<Task<CoverageBoardData>> answer, Func<Task<(CoverageResult? Failure, Guid ResultId)>> work,
        CancellationToken cancellationToken)
    {
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                if (key is { } receipt)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, receipt, accountId, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return CoverageResult.Fail(PositionCoverageFailure.Conflict, null, IdempotencyConflictCode);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return new CoverageResult(await answer(), null, []);
                }
                var (failure, resultId) = await work();
                if (failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return failure;
                }
                if (key is { } done) CommercialCommandReceipts.Add(context, done, accountId, action, hash, resultId, Now());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new CoverageResult(await answer(), null, []);
            });
        }
        catch (DbUpdateException exception) when (key is { } receipt && CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent attempt of the same intent committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, receipt, accountId, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? new CoverageResult(await answer(), null, [])
                : CoverageResult.Fail(PositionCoverageFailure.Conflict, null, IdempotencyConflictCode);
        }
        catch (Exception exception) when (IsConcurrentWrite(exception))
        {
            context.ChangeTracker.Clear();
            return CoverageResult.Fail(PositionCoverageFailure.Conflict, null, VersionConflictCode);
        }
    }

    /// <summary>A stale row, a deadlock, a snapshot conflict or a unique index another command filled first.</summary>
    private static bool IsConcurrentWrite(Exception exception) =>
        exception is DbUpdateConcurrencyException ||
        (exception is DbUpdateException or RetryLimitExceededException or SqlException &&
         exception.GetBaseException() is SqlException { Number: 1205 or 3960 or 2601 or 2627 });

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
