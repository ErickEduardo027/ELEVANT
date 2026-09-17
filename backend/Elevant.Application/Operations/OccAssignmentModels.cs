namespace Elevant.Application.Operations;

public sealed record OccAssignmentWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid TurnaroundId,
    Guid AgentId,
    byte[] ExpectedContextVersion,
    Guid CorrelationId,
    string? RequestId);

public sealed record OccAssignmentData(
    Guid TurnaroundId,
    OccGroundOperationData Operation,
    OccAssignedAgentData Assignment,
    IReadOnlyList<OccOperationServiceData> Services,
    string ConcurrencyToken);

public enum OccAssignmentWriteFailure
{
    NotFound,
    Conflict,
    PreconditionFailed,
}

public sealed record OccAssignmentWriteResult(
    OccAssignmentData? Assignment,
    OccAssignmentWriteFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Assignment is not null && Failure is null;

    public static OccAssignmentWriteResult Success(
        OccAssignmentData assignment,
        Guid commitReceiptId) =>
        new(assignment, null, commitReceiptId);

    public static OccAssignmentWriteResult Failed(OccAssignmentWriteFailure failure) =>
        new(null, failure, null);
}
