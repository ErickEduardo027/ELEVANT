using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations;

public sealed class OperationalPresenceHandler(
    OperationalCommunicationHandler communication, IOperationalCommunicationStore store,
    OperationalPresenceRegistry registry, TimeProvider clock)
{
    public async Task<CommunicationResult<OperationalAccess>> HeartbeatAsync(
        Guid accountId, PresenceHeartbeat heartbeat, CancellationToken cancellationToken)
    {
        var access = await communication.AuthorizePresenceAsync(accountId, cancellationToken);
        if (!access.IsSuccess) return access;
        return registry.Write(accountId, heartbeat) ? access :
            CommunicationResults.Failed<OperationalAccess>(OperationalCommunicationFailure.InvalidRequest);
    }

    public async Task<CommunicationResult<OwnPresence>> ReadOwnAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var access = await communication.AuthorizePresenceAsync(accountId, cancellationToken);
        return access.IsSuccess ? CommunicationResults.Success(registry.ReadOwn(accountId))
            : CommunicationResults.Failed<OwnPresence>(access.Failure!.Value);
    }

    public async Task<CommunicationResult<OwnPresence>> SetStatusAsync(
        Guid accountId, PresenceStatusUpdate update, CancellationToken cancellationToken)
    {
        var access = await communication.AuthorizePresenceAsync(accountId, cancellationToken);
        if (!access.IsSuccess) return CommunicationResults.Failed<OwnPresence>(access.Failure!.Value);
        return registry.SetStatus(accountId, update) ? CommunicationResults.Success(registry.ReadOwn(accountId))
            : CommunicationResults.Failed<OwnPresence>(OperationalCommunicationFailure.InvalidRequest);
    }

    public async Task<CommunicationResult<OperationPresenceList>> ReadAsync(
        Guid accountId, IReadOnlyCollection<Guid> operationIds, CancellationToken cancellationToken)
    {
        var access = await communication.AuthorizePresenceAsync(accountId, cancellationToken);
        if (!access.IsSuccess) return CommunicationResults.Failed<OperationPresenceList>(access.Failure!.Value);
        if (operationIds.Count is < 1 or > 100 || operationIds.Contains(Guid.Empty))
            return CommunicationResults.Failed<OperationPresenceList>(OperationalCommunicationFailure.InvalidRequest);
        var contacts = await store.GetPresenceParticipantsAsync(access.Value!, operationIds.Distinct().ToArray(), cancellationToken);
        if (!contacts.IsSuccess) return CommunicationResults.Failed<OperationPresenceList>(contacts.Failure!.Value);
        var states = contacts.Value!.Operations.SelectMany(item => item.Participants).Select(item => item.AccountId)
            .Distinct().ToDictionary(id => id, registry.Read);
        return CommunicationResults.Success(new OperationPresenceList(clock.GetUtcNow(),
            contacts.Value.Operations.Select(operation => new OperationPresenceData(operation.OperationId,
                operation.Participants.Select(person => new ParticipantPresence(person.AccountId, person.Name, person.Role,
                    states[person.AccountId].State, states[person.AccountId].LastActivityAt,
                    states[person.AccountId].Availability, states[person.AccountId].Message)).ToArray())).ToArray()));
    }
}
