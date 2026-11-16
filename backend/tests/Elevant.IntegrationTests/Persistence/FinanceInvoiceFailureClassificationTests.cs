using Elevant.Persistence.Finance;
using Xunit;

namespace Elevant.IntegrationTests.Persistence;

public sealed class FinanceInvoiceFailureClassificationTests
{
    [Theory]
    [InlineData(2601, true)]
    [InlineData(2627, true)]
    [InlineData(1205, false)]
    [InlineData(1222, false)]
    [InlineData(3960, false)]
    public void OnlyUniqueConstraintFailuresAreResolvedAsReplayOrConflict(
        int sqlNumber, bool expected)
    {
        Assert.Equal(expected, EfFinanceInvoiceIssueStore.IsUniquenessConflict(sqlNumber));
    }
}
