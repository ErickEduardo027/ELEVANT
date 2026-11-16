namespace Elevant.Application.Operations.GetRampOperationChecklist;

public sealed record GetRampOperationChecklistQuery(
    Guid AccountId,
    Guid OperationId);
