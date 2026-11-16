using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IAttendanceValidationStore
{
    Task<HumanResourcesAttendancePage?> ListAsync(
        Guid actorAccountId,
        Guid stationId,
        DateOnly startDate,
        DateOnly endDate,
        int page,
        int limit,
        CancellationToken cancellationToken = default);

    Task<AttendanceValidationResult> ValidateAsync(
        AttendanceValidationCommand command,
        CancellationToken cancellationToken = default);
}
