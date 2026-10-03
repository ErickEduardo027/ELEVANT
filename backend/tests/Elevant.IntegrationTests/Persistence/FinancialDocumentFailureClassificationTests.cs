using Elevant.Persistence.Finance;

namespace Elevant.IntegrationTests.Persistence;

public sealed class FinancialDocumentFailureClassificationTests
{
    [Theory]
    [InlineData(2601, true)]
    [InlineData(2627, true)]
    [InlineData(1205, false)]
    [InlineData(3960, false)]
    public void OnlyUniqueIndexRacesMayReadTheExistingDocument(int number, bool expected)
    {
        Assert.Equal(expected, EfFinancialDocumentStore.IsUniquenessConflict(number));
    }
}
