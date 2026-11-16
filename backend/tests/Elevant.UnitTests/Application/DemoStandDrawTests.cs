using System.Globalization;
using Elevant.Application.Operations.DemoStation;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041, owner decision 22: «Al azar» draws one of the eligible stands with the command's Idempotency-Key as the
/// seed, so a retry of the same command gets the same stand.
/// </summary>
public sealed class DemoStandDrawTests
{
    // Not in order on purpose: the draw sorts them by their text first.
    private static readonly Guid[] Stands =
    [
        Guid.Parse("23000000-0000-7000-8000-000000000005"),
        Guid.Parse("23000000-0000-7000-8000-000000000001"),
        Guid.Parse("23000000-0000-7000-8000-000000000003"),
        Guid.Parse("23000000-0000-7000-8000-000000000004"),
        Guid.Parse("23000000-0000-7000-8000-000000000002"),
    ];

    private static Guid Key(int index) =>
        new(string.Concat("0193a6f2-5c1e-7d3a-9b44-", index.ToString("x12", CultureInfo.InvariantCulture)));

    private static IEnumerable<Guid> Keys(int count) => Enumerable.Range(0, count).Select(Key);

    [Fact]
    public void TheSameKeyAlwaysDrawsTheSameStand()
    {
        foreach (var key in Keys(50))
        {
            var drawn = DemoStandDraw.Pick(Stands, key);
            Assert.NotNull(drawn);
            Assert.All(Enumerable.Range(0, 5), _ => Assert.Equal(drawn, DemoStandDraw.Pick(Stands, key)));
        }
        // The rule is written down, not left to the runtime: the first eight bytes of the SHA-256 of the key (big-endian)
        // modulo the number of candidates, sorted by their text. These keys hash to 0x604dad1e… and 0xa61ecc30….
        Assert.Equal(Guid.Parse("23000000-0000-7000-8000-000000000002"), DemoStandDraw.Pick(Stands, Key(2)));
        Assert.Equal(Guid.Parse("23000000-0000-7000-8000-000000000005"), DemoStandDraw.Pick(Stands, Key(3)));
    }

    [Fact]
    public void TheOrderOfTheCandidatesDoesNotChangeTheDraw()
    {
        foreach (var key in Keys(50))
        {
            var drawn = DemoStandDraw.Pick(Stands, key);
            Assert.Equal(drawn, DemoStandDraw.Pick(Enumerable.Reverse(Stands).ToArray(), key));
            Assert.Equal(drawn, DemoStandDraw.Pick(Stands.Order().ToArray(), key));
            Assert.Equal(drawn, DemoStandDraw.Pick([.. Stands.Skip(2), .. Stands.Take(2)], key));
            // A candidate listed twice counts once.
            Assert.Equal(drawn, DemoStandDraw.Pick([.. Stands, Stands[0], Stands[3]], key));
        }
    }

    [Fact]
    public void WithoutCandidatesNothingIsDrawn()
    {
        Assert.Null(DemoStandDraw.Pick([], Key(1)));
        Assert.Null(DemoStandDraw.Pick([], Guid.Empty));
        Assert.Throws<ArgumentNullException>(() => DemoStandDraw.Pick(null!, Key(1)));
    }

    [Fact]
    public void TheDrawIsAlwaysACandidate()
    {
        foreach (var key in Keys(200).Append(Guid.Empty).Append(Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff")))
        {
            Assert.Contains(Assert.NotNull(DemoStandDraw.Pick(Stands, key)), Stands);
            Assert.Contains(Assert.NotNull(DemoStandDraw.Pick(Stands[..2], key)), Stands[..2]);
            // With one candidate there is nothing to draw.
            Assert.Equal(Stands[0], DemoStandDraw.Pick([Stands[0]], key));
        }
    }

    [Fact]
    public void EveryCandidateCanBeDrawn()
    {
        var drawn = Keys(200).Select(key => DemoStandDraw.Pick(Stands, key)).OfType<Guid>().ToHashSet();

        Assert.Equal(Stands.Order(), drawn.Order());
    }
}
