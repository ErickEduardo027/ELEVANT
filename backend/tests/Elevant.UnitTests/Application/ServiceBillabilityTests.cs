using Elevant.Application.Finance;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>3-N11: the one rule of what is billed of an executed service.</summary>
public sealed class ServiceBillabilityTests
{
    [Theory]
    [InlineData(ServiceExecutionStatus.Completed, "1", false, true)]
    [InlineData(ServiceExecutionStatus.Exception, "2", false, true)]
    [InlineData(ServiceExecutionStatus.Exception, "2", true, false)]
    [InlineData(ServiceExecutionStatus.Exception, "0", false, false)]
    [InlineData(ServiceExecutionStatus.Completed, "0", false, false)]
    [InlineData(ServiceExecutionStatus.NotPerformed, "0", false, false)]
    [InlineData(ServiceExecutionStatus.InProgress, "1", false, false)]
    [InlineData(ServiceExecutionStatus.Planned, "1", false, false)]
    public void CompletedOrExceptionWithItsQuantityIsBilledUnlessOccExcludedIt(ServiceExecutionStatus status,
        string executed, bool excluded, bool billable)
    {
        var quantity = decimal.Parse(executed, System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(billable, ServiceBillability.IsBillable(status, quantity, excluded));
        // The query predicate is the same rule.
        var service = new OperationService
        {
            CurrentStatus = status, ExecutedQuantity = quantity,
            BillingExcludedAt = excluded ? DateTimeOffset.UtcNow : null,
        };
        Assert.Equal(billable, ServiceBillability.Billable.Compile()(service));
    }

    [Theory]
    [InlineData(ServiceExecutionStatus.Exception, "2", true)]
    [InlineData(ServiceExecutionStatus.Exception, "0", false)]
    [InlineData(ServiceExecutionStatus.Completed, "2", false)]
    [InlineData(ServiceExecutionStatus.NotPerformed, "0", false)]
    public void OnlyAServiceInExceptionWithAQuantityIsExcludedInTheReview(ServiceExecutionStatus status, string executed,
        bool allowed) =>
        Assert.Equal(allowed, ServiceBillability.CanExclude(status,
            decimal.Parse(executed, System.Globalization.CultureInfo.InvariantCulture)));
}
