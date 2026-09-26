namespace Elevant.Application.Operations.GetManualTurnaroundOptions;

public sealed record GetManualTurnaroundOptionsQuery(
    Guid AccountId, Guid StationId, DateOnly Date);
