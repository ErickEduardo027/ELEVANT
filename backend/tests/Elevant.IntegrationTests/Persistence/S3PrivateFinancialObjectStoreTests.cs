using Elevant.Persistence.Finance;
using Microsoft.Extensions.Configuration;

namespace Elevant.IntegrationTests.Persistence;

public sealed class S3PrivateFinancialObjectStoreTests
{
    [Fact]
    public async Task PutUsesPlainSignedPayloadAcceptedByGarageCompatibleStorage()
    {
        await using var server = await GarageCompatibleS3Server.StartAsync(
            TestContext.Current.CancellationToken);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?>
            {
                ["MediaStorage:Endpoint"] = server.Endpoint,
                ["MediaStorage:AccessKey"] = "synthetic-access",
                ["MediaStorage:SecretKey"] = "synthetic-secret",
                ["MediaStorage:Bucket"] = "synthetic-bucket",
                ["MediaStorage:Region"] = "garage",
            }).Build();
        var content = "%PDF-1.7\nsynthetic\n%%EOF"u8.ToArray();

        var store = new S3PrivateFinancialObjectStore(configuration);
        const string key = "finance/invoice/synthetic.pdf";
        await store.PutAsync(key, content, TestContext.Current.CancellationToken);

        Assert.Equal(content, server.LastUploadedContent);
        Assert.Equal("/synthetic-bucket/finance/invoice/synthetic.pdf", server.LastUploadedPath);
        Assert.Equal(content, await store.GetAsync(key, TestContext.Current.CancellationToken));
        await store.DeleteAsync(key, TestContext.Current.CancellationToken);
        Assert.Null(await store.GetAsync(key, TestContext.Current.CancellationToken));
    }
}
