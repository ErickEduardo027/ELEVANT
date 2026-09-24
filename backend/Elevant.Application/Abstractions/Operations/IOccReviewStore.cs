using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IOccReviewStore
{
    Task<OccReviewQueueData?> GetQueueAsync(
        Guid stationId, CancellationToken cancellationToken = default);

    Task<OccReviewDetailData?> GetDetailAsync(
        Guid operationId, IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default);

    Task<OccReviewDetailData?> GetSubmissionDetailAsync(
        Guid operationId, Guid submissionId, IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default);

    Task<OccReviewDecisionWriteResult> DecideAsync(
        OccReviewDecisionWriteRequest request, CancellationToken cancellationToken = default);
}
