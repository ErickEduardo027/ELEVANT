using System.Runtime.CompilerServices;
using Elevant.Persistence.Commercial;
using Elevant.Infrastructure.Persistence.Seed;

namespace Elevant.IntegrationTests.Persistence;

public sealed class CommercialMediaTests
{
    [Theory]
    [InlineData("RAMP-CARGO", "/assets/generated/hero-ramp.webp", "/assets/services/cargo-loading.webp")]
    [InlineData("RAMP-STAIRS", "/assets/generated/hero-ramp.webp", "/assets/services/mobile-stairs.webp")]
    [InlineData("RAMP-CARGO", "/api/v1/media/00000000-0000-0000-0000-000000000001", "/api/v1/media/00000000-0000-0000-0000-000000000001")]
    public void OnlyUntouchedFixtureImagesAreReplaced(string code, string original, string expected)
    {
        Assert.Equal(expected, CommercialServiceMediaDefaults.Resolve(code, original));
    }

    [Fact]
    public void UploadSignatureRejectsMismatchedExtensionClaims()
    {
        Assert.True(EfCommercialMediaStore.MatchesSignature(
            [137, 80, 78, 71, 13, 10, 26, 10, 0], "image/png", video: false));
        Assert.False(EfCommercialMediaStore.MatchesSignature(
            [137, 80, 78, 71, 13, 10, 26, 10, 0], "video/mp4", video: true));
        Assert.False(EfCommercialMediaStore.MatchesSignature(
            "<svg></svg>"u8.ToArray(), "image/svg+xml", video: false));
    }

    [Fact]
    public void NewLinksExpireBeforeAnUnlinkedObjectCanBeCleaned()
    {
        var now = new DateTimeOffset(2026, 9, 27, 18, 0, 0, TimeSpan.Zero);
        var linkCutoff = CommercialMediaLinkPolicy.LinkCutoff(now);
        var cleanupCutoff = CommercialMediaLinkPolicy.CleanupCutoff(now);
        Assert.Equal(TimeSpan.FromDays(1), linkCutoff - cleanupCutoff);
        Assert.True(now.AddDays(-6).AddTicks(1) >= linkCutoff);
        Assert.False(now.AddDays(-6).AddTicks(-1) >= linkCutoff);
        Assert.False(now.AddDays(-7).AddTicks(1) < cleanupCutoff);
        Assert.True(now.AddDays(-7).AddTicks(-1) < cleanupCutoff);
    }

    [Fact]
    public void EveryHistoricalAirlineHasAnAssetInBothWebClients()
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "frontend")))
            root = root.Parent;
        // Isolated test output and testhost working directories may both be outside the worktree.
        root ??= new DirectoryInfo(Path.GetDirectoryName(SourcePath())!);
        while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "frontend")))
            root = root.Parent;
        Assert.NotNull(root);
        Assert.Equal(51, AviamAirlineReference.Research.Count);
        foreach (var airline in AviamAirlineReference.Research.Keys)
        {
            Assert.True(AviamAirlineReference.LogoPaths.TryGetValue(airline, out var path), airline);
            foreach (var client in new[] { "private-web", "public-web" })
            {
                var asset = Path.Combine(root.FullName, "frontend", client, "public", path!.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
                Assert.True(File.Exists(asset), $"{client}: {airline} -> {path}");
            }
        }
    }

    private static string SourcePath([CallerFilePath] string path = "") => path;
}
