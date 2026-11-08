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

    Task<OccReviewSubmissionHistoryData?> GetSubmissionHistoryAsync(
        Guid operationId, IReadOnlyCollection<Guid> allowedStationIds,
        CancellationToken cancellationToken = default);

    Task<OccReviewChargeAdjustResult> AdjustChargeAsync(
        OccReviewChargeAdjustRequest request, CancellationToken cancellationToken = default);

    Task<OccReviewDecisionWriteResult> DecideAsync(
        OccReviewDecisionWriteRequest request, CancellationToken cancellationToken = default);

    /// <summary>3-N11: excludes a service in exception from billing, or includes it again; answers the new version.</summary>
    Task<OccReviewChargeAdjustResult> SetServiceBillingExclusionAsync(
        OccReviewBillingExclusionRequest request, CancellationToken cancellationToken = default);

    /// <summary>3-H: reopens an approval nothing was invoiced from yet as a new pending revision.</summary>
    Task<OccReviewReopenResult> ReopenAsync(
        OccReviewReopenRequest request, CancellationToken cancellationToken = default);
}
