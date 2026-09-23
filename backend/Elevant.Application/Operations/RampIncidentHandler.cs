using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public sealed class RampIncidentHandler(
    IActorContextResolver actorResolver,
    IRampIncidentStore store)
{
    public async Task<RampIncidentReadResult> GetAsync(
        Guid accountId,
        Guid operationId,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveAccessAsync(accountId, cancellationToken);
        if (access.Failure is RampOperationsFailure failure)
        {
            return RampIncidentReadResult.Failed(failure);
        }

        return operationId == Guid.Empty
            ? RampIncidentReadResult.Failed(RampOperationsFailure.InvalidRequest)
            : await store.GetAsync(
                new RampIncidentReadRequest(accountId, access.StationIds!, operationId),
                cancellationToken);
    }

    public async Task<RampIncidentWriteResult> ReportAsync(
        Guid accountId,
        Guid operationId,
        string incidentType,
        IncidentSeverity severity,
        string description,
        DateTimeOffset occurredAt,
        Guid installationId,
        Guid idempotencyKey,
        string? requestId,
        CancellationToken cancellationToken = default)
    {
        if (operationId == Guid.Empty ||
            installationId == Guid.Empty ||
            idempotencyKey == Guid.Empty ||
            !RampIncidentPolicy.IsValid(incidentType, severity, description, occurredAt))
        {
            return RampIncidentWriteResult.Failed(RampOperationsFailure.InvalidRequest);
        }

        var access = await ResolveAccessAsync(accountId, cancellationToken);
        if (access.Failure is RampOperationsFailure failure)
        {
            return RampIncidentWriteResult.Failed(failure);
        }

        return await store.ReportAsync(new RampIncidentWriteRequest(
            accountId,
            access.StationIds!,
            operationId,
            incidentType,
            severity,
            description.Trim(),
            occurredAt,
            installationId,
            idempotencyKey,
            idempotencyKey,
            requestId), cancellationToken);
    }

    private async Task<AccessResult> ResolveAccessAsync(
        Guid accountId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty)
        {
            return new(null, RampOperationsFailure.Unauthorized);
        }

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
        {
            return new(null, RampOperationsFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return new(null, RampOperationsFailure.Forbidden);
        }

        var stations = actor!.StationScopes.Select(scope => scope.StationId)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        return stations.Length == 0
            ? new(null, RampOperationsFailure.NotFound)
            : new(stations, null);
    }

    private sealed record AccessResult(Guid[]? StationIds, RampOperationsFailure? Failure);
}
