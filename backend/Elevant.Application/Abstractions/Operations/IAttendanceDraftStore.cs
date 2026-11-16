using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IAttendanceDraftStore
{
    Task<AttendanceDraftReadResult> GetAsync(
        Guid actorAccountId,
        Guid operationId,
        Guid assignmentId,
        Guid? installationId,
        CancellationToken cancellationToken = default);

    Task<AttendanceDraftWriteResult> SaveAsync(
        AttendanceDraftWriteRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 3-F: the assignments of the turnaround's operation whose attendance OCC records: the open ones and the ones a
    /// handover released after the start, which the planning board no longer lists. AVIAM staff of the station with
    /// <c>operations.attendance.read</c>.
    /// </summary>
    Task<OccAttendanceAssignmentsReadResult> ListOccAssignmentsAsync(
        Guid actorAccountId,
        Guid turnaroundId,
        CancellationToken cancellationToken = default);
}
