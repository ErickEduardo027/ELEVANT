using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;

namespace Elevant.Application.Operations.CreateManualTurnaround;

public sealed class CreateManualTurnaroundHandler(
    IActorContextResolver actorContextResolver,
    IManualTurnaroundStore store)
{
    public async Task<CreateManualTurnaroundResult> HandleAsync(
        CreateManualTurnaroundCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();

        if (command.AccountId == Guid.Empty)
            return CreateManualTurnaroundResult.Failed(OccPlanningFailure.Unauthorized);

        var arrivalNumber = NormalizeFlightNumber(command.ArrivalFlightNumber);
        var departureNumber = NormalizeFlightNumber(command.DepartureFlightNumber);
        var originIata = command.ArrivalOriginIata?.Trim().ToUpperInvariant() ?? string.Empty;
        var destinationIata = command.DepartureDestinationIata?.Trim().ToUpperInvariant() ?? string.Empty;
        if (command.TurnaroundId == Guid.Empty || command.StationId == Guid.Empty ||
            command.AirlineId == Guid.Empty || command.StandId == Guid.Empty ||
            command.CorrelationId == Guid.Empty ||
            command.OperationDate == default ||
            !IsFlightNumber(arrivalNumber) || !IsFlightNumber(departureNumber) ||
            !IsIata(originIata) || !IsIata(destinationIata) ||
            command.ArrivalScheduledAt.Offset != TimeSpan.Zero ||
            command.DepartureScheduledAt.Offset != TimeSpan.Zero ||
            command.DepartureScheduledAt <= command.ArrivalScheduledAt ||
            command.DepartureScheduledAt - command.ArrivalScheduledAt > TimeSpan.FromHours(24))
            return CreateManualTurnaroundResult.Failed(OccPlanningFailure.InvalidRequest);

        var actor = await actorContextResolver.ResolveAsync(command.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
            return CreateManualTurnaroundResult.Failed(OccPlanningFailure.Unauthorized);
        if (!OccPlanningAccess.IsAuthorized(actor!))
            return CreateManualTurnaroundResult.Failed(OccPlanningFailure.Forbidden);

        var stationScope = actor!.StationScopes.SingleOrDefault(scope => scope.StationId == command.StationId);
        if (stationScope is null)
            return CreateManualTurnaroundResult.Failed(OccPlanningFailure.NotFound);
        if (string.Equals(originIata, stationScope.StationCode, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(destinationIata, stationScope.StationCode, StringComparison.OrdinalIgnoreCase))
            return CreateManualTurnaroundResult.Failed(OccPlanningFailure.InvalidRequest);

        var result = await store.CreateAsync(new ManualTurnaroundWriteRequest(
            command.AccountId,
            actor.StationScopes.Select(scope => scope.StationId).Distinct().ToArray(),
            command.TurnaroundId,
            command.StationId,
            command.AirlineId,
            command.StandId,
            command.OperationDate,
            arrivalNumber,
            originIata,
            command.ArrivalScheduledAt,
            departureNumber,
            destinationIata,
            command.DepartureScheduledAt,
            command.CorrelationId,
            command.RequestId), cancellationToken);

        return result.IsSuccess
            ? CreateManualTurnaroundResult.Success(result.TurnaroundId!.Value, result.OperationCode!, result.Replayed)
            : CreateManualTurnaroundResult.Failed(result.Failure switch
            {
                ManualTurnaroundWriteFailure.NotFound => OccPlanningFailure.NotFound,
                ManualTurnaroundWriteFailure.Conflict => OccPlanningFailure.Conflict,
                _ => throw new InvalidOperationException("Unsupported manual turnaround write failure."),
            });
    }

    private static string NormalizeFlightNumber(string? value) =>
        value is null ? string.Empty : string.Concat(value.Where(c => !char.IsWhiteSpace(c))).ToUpperInvariant();

    private static bool IsFlightNumber(string value) =>
        value.Length is >= 2 and <= 16 && value.All(c => c is >= 'A' and <= 'Z' or >= '0' and <= '9');

    private static bool IsIata(string value) =>
        value.Length == 3 && value.All(c => c is >= 'A' and <= 'Z');
}
