using Elevant.Infrastructure.Commercial;

namespace Elevant.UnitTests.Infrastructure;

public sealed class LocalContractObjectStoreTests
{
    [Fact]
    public async Task StoresPrivateBytesImmutablyAndRejectsTraversal()
    {
        var directory = Path.Combine(Path.GetTempPath(),
            "elevant-contract-store-" + Guid.NewGuid().ToString("N"));
        try
        {
            var store = new LocalContractObjectStore(directory);
            var content = "%PDF-1.7\nVersion one\n%%EOF"u8.ToArray();
            const string key = "contracts/11111111/draft.pdf";
            await store.PutAsync(key, content);
            Assert.Equal(content, await store.GetAsync(key));
            await store.PutAsync(key, content);
            await Assert.ThrowsAsync<InvalidDataException>(() =>
                store.PutAsync(key, "%PDF-1.7\nChanged\n%%EOF"u8.ToArray()));
            await Assert.ThrowsAsync<ArgumentException>(() =>
                store.GetAsync("contracts/../private.pdf"));
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
