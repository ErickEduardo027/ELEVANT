using System.Text.Json;
using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041: one rule to compare stand codes for the API and the web. The vectors are the file
/// <c>backend/Elevant.Application/Operations/StandCodes.vectors.json</c>, which the JavaScript tests read too.
/// </summary>
public sealed class StandCodesTests
{
    private sealed record Vector(string Input, string Expected);

    private sealed record SharedVectors(IReadOnlyList<Vector> Normalize, IReadOnlyList<IReadOnlyList<string>> Distinct);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static SharedVectors Load() =>
        JsonSerializer.Deserialize<SharedVectors>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "StandCodes.vectors.json")), Json)!;

    [Fact]
    public void NormalizesEverySharedVector()
    {
        var vectors = Load().Normalize;

        Assert.All(vectors, vector =>
        {
            Assert.Equal(vector.Expected, StandCodes.Normalize(vector.Input));
            // A stand has one normalized code: normalizing it again changes nothing.
            Assert.Equal(vector.Expected, StandCodes.Normalize(vector.Expected));
        });
        // The file still holds the cases the rule was written for: «A01», «a-1» and «A1» are one stand.
        Assert.Contains(new Vector("A01", "A1"), vectors);
        Assert.Contains(new Vector("a-1", "A1"), vectors);
        Assert.Contains(new Vector("A1", "A1"), vectors);
        Assert.Contains(new Vector("09A", "9A"), vectors);
        Assert.Equal(string.Empty, StandCodes.Normalize(null));
    }

    [Fact]
    public void NeverInfersAnotherStand()
    {
        var pairs = Load().Distinct;

        Assert.NotEmpty(pairs);
        Assert.All(pairs, pair =>
        {
            Assert.Equal(2, pair.Count);
            Assert.NotEqual(StandCodes.Normalize(pair[0]), StandCodes.Normalize(pair[1]));
        });
        // The airport's own notation stays as typed: no letter is added, moved or dropped.
        Assert.Equal("1", StandCodes.Normalize("1"));
        Assert.Equal("9A", StandCodes.Normalize("9A"));
        Assert.Equal("23A", StandCodes.Normalize("23A"));
    }
}
