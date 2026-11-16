using Elevant.Application.Operations;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Revalidates the live ramp-agent, installation and operation boundary inside
/// the same database transaction that serves a read or commits a command.
/// </summary>
internal sealed class EfRampExecutionAuthorization(
    ElevantDbContext context,
    TimeProvider timeProvider)
{
    public async Task<RampExecutionActorAccessResult> ResolveActorAsync(
        Guid actorAccountId,
        IReadOnlyCollection<Guid> allowedStationIds,
        Guid? installationId,
        CancellationToken cancellationToken)
    {
        var requestedStationIds = allowedStationIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (requestedStationIds.Length == 0)
        {
            return RampExecutionActorAccessResult.NotFound();
        }

        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(actorAccountId, cancellationToken);
        if (liveActor is null ||
            liveActor.AccountId != actorAccountId ||
            !RampOperationsAccess.IsAuthorized(liveActor))
        {
            return RampExecutionActorAccessResult.Forbidden();
        }

        var liveStationIds = liveActor.StationScopes
            .Select(scope => scope.StationId)
            .ToHashSet();
        var stationPublicIds = requestedStationIds
            .Where(liveStationIds.Contains)
            .ToArray();
        if (stationPublicIds.Length == 0)
        {
            return RampExecutionActorAccessResult.NotFound();
        }

        var profiles = await (
                from account in context.Users.AsNoTracking()
                join agent in context.RampAgents.AsNoTracking()
                    on account.PersonId equals agent.PersonId
                where account.PublicId == actorAccountId && agent.IsActive
                select new ActorProfile(
                    account.Id,
                    agent.Id,
                    agent.PublicId))
            .Take(2)
            .ToArrayAsync(cancellationToken);
        if (profiles.Length != 1)
        {
            return RampExecutionActorAccessResult.Forbidden();
        }

        MobileDevice? device = null;
        if (installationId is Guid requiredInstallationId)
        {
            device = await context.MobileDevices
                .FromSqlInterpolated($"""
                    SELECT *
                    FROM [integration].[mobile_devices] WITH (UPDLOCK, HOLDLOCK)
                    WHERE [installation_id] = {requiredInstallationId}
                    """)
                .SingleOrDefaultAsync(cancellationToken);
            if (device is null || device.RevokedAt is not null)
            {
                return RampExecutionActorAccessResult.Forbidden();
            }

            var binding = await context.Set<MobileDeviceAccountBinding>()
                .FromSqlInterpolated($"""
                    SELECT *
                    FROM [integration].[mobile_device_account_bindings] WITH (UPDLOCK, HOLDLOCK)
                    WHERE [mobile_device_id] = {device.Id}
                      AND [unbound_at] IS NULL
                    """)
                .SingleOrDefaultAsync(cancellationToken);
            if (binding is null || binding.AccountId != profiles[0].AccountInternalId)
            {
                return RampExecutionActorAccessResult.Forbidden();
            }
        }

        return RampExecutionActorAccessResult.Success(new RampExecutionActorAccess(
            profiles[0].AccountInternalId,
            profiles[0].RampAgentInternalId,
            profiles[0].RampAgentPublicId,
            liveActor.DisplayName,
            stationPublicIds,
            device));
    }

    public async Task<RampOperationExecutionScope?> ResolveOperationAsync(
        RampExecutionActorAccess actor,
        Guid operationId,
        bool lockForUpdate,
        CancellationToken cancellationToken)
    {
        GroundOperation? operation;
        if (lockForUpdate)
        {
            operation = await context.GroundOperations
                .FromSqlInterpolated($"""
                    SELECT *
                    FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                    WHERE [public_id] = {operationId}
                    """)
                .SingleOrDefaultAsync(cancellationToken);
        }
        else
        {
            operation = await context.GroundOperations
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    item => item.PublicId == operationId,
                    cancellationToken);
        }

        if (operation is null)
        {
            return null;
        }

        var scope = await (
                from turnaround in context.Turnarounds.AsNoTracking()
                join station in context.Stations.AsNoTracking()
                    on turnaround.StationId equals station.Id
                join airline in context.Airlines.AsNoTracking()
                    on turnaround.AirlineId equals airline.Id
                where turnaround.Id == operation.TurnaroundId &&
                      station.IsActive &&
                      actor.AllowedStationPublicIds.Contains(station.PublicId)
                select new OperationScopeProjection(
                    turnaround.PublicId,
                    turnaround.OperationDate,
                    turnaround.CurrentStatus,
                    station.Id,
                    airline.OrganizationId))
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null)
        {
            return null;
        }

        var hasActiveAssignment = await context.OperationAgentAssignments
            .AsNoTracking()
            .AnyAsync(
                assignment => assignment.GroundOperationId == operation.Id &&
                    assignment.RampAgentId == actor.RampAgentInternalId &&
                    assignment.ReleasedAt == null,
                cancellationToken);
        var hasStationScope = await context.Set<RampAgentStationScope>()
            .AsNoTracking()
            .AnyAsync(
                agentScope => agentScope.RampAgentId == actor.RampAgentInternalId &&
                    agentScope.StationId == scope.StationInternalId &&
                    agentScope.ValidFrom <= scope.OperationDate &&
                    (agentScope.ValidTo == null ||
                     agentScope.ValidTo >= scope.OperationDate),
                cancellationToken);
        if (!hasActiveAssignment || !hasStationScope)
        {
            return null;
        }

        // 3-N03: once the agent started it, the operation follows its agent until it ends: the open assignment and the
        // station scope authorize it, even if OCC moved the flight to a terminal outside the agent's scope or the stand
        // was deactivated. Handing it to someone else is an explicit handover (3-F).
        if (OperationOccupancyRules.HasStarted(operation.ActualStartAt))
        {
            return ToScope(operation, scope);
        }

        var stand = await (
                from assignment in context.Set<StandAssignment>().AsNoTracking()
                join item in context.Stands.AsNoTracking()
                    on assignment.StandId equals item.Id
                where assignment.TurnaroundId == operation.TurnaroundId &&
                      assignment.AssignedTo == null
                select new StandScope(
                    item.StationId,
                    item.TerminalId,
                    item.IsActive))
            .SingleOrDefaultAsync(cancellationToken);
        if (stand is not null &&
            (!stand.IsActive || stand.StationInternalId != scope.StationInternalId))
        {
            return null;
        }

        if (stand?.TerminalInternalId is long terminalId)
        {
            var hasTerminalScope = await (
                    from terminal in context.Terminals.AsNoTracking()
                    where terminal.Id == terminalId &&
                          terminal.StationId == scope.StationInternalId &&
                          terminal.IsActive &&
                          context.Set<RampAgentTerminalScope>().AsNoTracking().Any(agentScope =>
                              agentScope.RampAgentId == actor.RampAgentInternalId &&
                              agentScope.TerminalId == terminal.Id &&
                              agentScope.ValidFrom <= scope.OperationDate &&
                              (agentScope.ValidTo == null ||
                               agentScope.ValidTo >= scope.OperationDate))
                    select terminal.Id)
                .AnyAsync(cancellationToken);
            if (!hasTerminalScope)
            {
                return null;
            }
        }

        return ToScope(operation, scope);
    }

    private static RampOperationExecutionScope ToScope(GroundOperation operation, OperationScopeProjection scope) => new(
        operation,
        scope.TurnaroundPublicId,
        scope.OperationDate,
        scope.TurnaroundStatus,
        scope.StationInternalId,
        scope.AirlineOrganizationInternalId);

    private sealed record ActorProfile(
        long AccountInternalId,
        long RampAgentInternalId,
        Guid RampAgentPublicId);

    private sealed record OperationScopeProjection(
        Guid TurnaroundPublicId,
        DateOnly OperationDate,
        TurnaroundStatus TurnaroundStatus,
        long StationInternalId,
        long AirlineOrganizationInternalId);

    private sealed record StandScope(
        long StationInternalId,
        long? TerminalInternalId,
        bool IsActive);
}

internal enum RampExecutionAuthorizationFailure
{
    Forbidden,
    NotFound,
}

internal sealed record RampExecutionActorAccess(
    long AccountInternalId,
    long RampAgentInternalId,
    Guid RampAgentPublicId,
    string DisplayName,
    Guid[] AllowedStationPublicIds,
    MobileDevice? Device);

internal sealed record RampExecutionActorAccessResult(
    RampExecutionActorAccess? Access,
    RampExecutionAuthorizationFailure? Failure)
{
    public bool IsSuccess => Access is not null && Failure is null;

    public static RampExecutionActorAccessResult Success(
        RampExecutionActorAccess access) => new(access, null);

    public static RampExecutionActorAccessResult Forbidden() =>
        new(null, RampExecutionAuthorizationFailure.Forbidden);

    public static RampExecutionActorAccessResult NotFound() =>
        new(null, RampExecutionAuthorizationFailure.NotFound);
}

internal sealed record RampOperationExecutionScope(
    GroundOperation Operation,
    Guid TurnaroundPublicId,
    DateOnly OperationDate,
    TurnaroundStatus TurnaroundStatus,
    long StationInternalId,
    long AirlineOrganizationInternalId);
