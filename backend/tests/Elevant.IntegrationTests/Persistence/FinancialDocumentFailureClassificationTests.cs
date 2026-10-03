using Elevant.Application.Finance;
using Elevant.Persistence.Finance;
using Microsoft.Extensions.Configuration;

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

    [Fact]
    public async Task MissingPrivateStorageConfigurationHasSafeDiagnosticStage()
    {
        var configuration = new ConfigurationBuilder().Build();
        var store = new S3PrivateFinancialObjectStore(configuration);

        var failure = await Assert.ThrowsAsync<FinancialDocumentUnavailableException>(
            () => store.PutAsync("finance/invoice/test.pdf", "%PDF-"u8.ToArray(),
                TestContext.Current.CancellationToken));

        Assert.Equal(FinancialDocumentFailureStage.StorageConfiguration, failure.Stage);
        Assert.Equal("Financial document is unavailable.", failure.Message);
    }

    [Fact]
    public async Task MissingPrivateStorageBucketRemainsConfigurationFailure()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["MediaStorage:Endpoint"] = "http://127.0.0.1:3900",
                ["MediaStorage:AccessKey"] = "synthetic-access",
                ["MediaStorage:SecretKey"] = "synthetic-secret",
            }).Build();
        var store = new S3PrivateFinancialObjectStore(configuration);

        var failure = await Assert.ThrowsAsync<FinancialDocumentUnavailableException>(
            () => store.PutAsync("finance/invoice/test.pdf", "%PDF-"u8.ToArray(),
                TestContext.Current.CancellationToken));

        Assert.Equal(FinancialDocumentFailureStage.StorageConfiguration, failure.Stage);
    }

    [Fact]
    public async Task InvalidPrivateStorageEndpointDoesNotEscapeUnclassified()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["MediaStorage:Endpoint"] = "not a valid service URL",
                ["MediaStorage:AccessKey"] = "synthetic-access",
                ["MediaStorage:SecretKey"] = "synthetic-secret",
                ["MediaStorage:Bucket"] = "synthetic-bucket",
            }).Build();
        var store = new S3PrivateFinancialObjectStore(configuration);

        var failure = await Assert.ThrowsAsync<FinancialDocumentUnavailableException>(
            () => store.PutAsync("finance/invoice/test.pdf", "%PDF-"u8.ToArray(),
                TestContext.Current.CancellationToken));

        Assert.Equal(FinancialDocumentFailureStage.StorageConfiguration, failure.Stage);
    }
}
