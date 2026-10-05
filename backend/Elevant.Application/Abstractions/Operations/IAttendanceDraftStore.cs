using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IAttendanceDraftStore
{
    Task<AttendanceDraftReadResult> GetAsync(
        Guid actorAccountId,
        Guid operationId,
        Guid assignmentId,
        CancellationToken cancellationToken = default);

    Task<AttendanceDraftWriteResult> SaveAsync(
        AttendanceDraftWriteRequest request,
        CancellationToken cancellationToken = default);
}
