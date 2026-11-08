using System.Linq.Expressions;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>
/// The one rule of what is billed of an executed service (3-N11): a completed service, or one in exception, with an
/// executed quantity, unless OCC excluded it from billing in the review. «Por facturar», the internal draft, the e-CF
/// issuance, the automatic surcharges and the reports all apply this rule and nothing else decides it.
/// </summary>
public static class ServiceBillability
{
    /// <summary>Whether a service with this status, executed quantity and exclusion is billed.</summary>
    public static bool IsBillable(ServiceExecutionStatus status, decimal executedQuantity, bool excludedInReview) =>
        !excludedInReview && executedQuantity > 0 && HasBillableStatus(status);

    /// <summary>Completed or in exception: the states whose executed quantity is billed.</summary>
    public static bool HasBillableStatus(ServiceExecutionStatus status) =>
        status is ServiceExecutionStatus.Completed or ServiceExecutionStatus.Exception;

    /// <summary>
    /// OCC may exclude a service from billing in the review only when it is in exception with an executed quantity: a
    /// completed service is billed as executed and one not performed has nothing to bill.
    /// </summary>
    public static bool CanExclude(ServiceExecutionStatus status, decimal executedQuantity) =>
        status == ServiceExecutionStatus.Exception && executedQuantity > 0;

    /// <summary>
    /// <see cref="IsBillable"/> as a query predicate over the live service (the enum is stored as text, so the states
    /// are compared one by one).
    /// </summary>
    public static readonly Expression<Func<OperationService, bool>> Billable = service =>
        service.BillingExcludedAt == null && service.ExecutedQuantity > 0 &&
        (service.CurrentStatus == ServiceExecutionStatus.Completed ||
         service.CurrentStatus == ServiceExecutionStatus.Exception);
}
