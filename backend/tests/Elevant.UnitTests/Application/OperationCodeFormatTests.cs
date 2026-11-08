using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

/// <summary>3-N27: the readable operation code, numbered per station and local day.</summary>
public sealed class OperationCodeFormatTests
{
    private static readonly DateOnly Day = new(2026, 11, 5);

    [Fact]
    public void TheCodeIsTheStationTheLocalDayAndAThreeDigitNumber()
    {
        Assert.Equal("PUJ-20261105-", OperationCodeFormat.Prefix(" puj ", Day));
        Assert.Equal("PUJ-20261105-001", OperationCodeFormat.Format("PUJ", Day, 1));
        Assert.Equal("PUJ-20261105-042", OperationCodeFormat.Format("PUJ", Day, 42));
        // A thousandth flight of the day keeps its number: it never wraps around.
        Assert.Equal("PUJ-20261105-1000", OperationCodeFormat.Format("PUJ", Day, 1000));
        Assert.Throws<ArgumentOutOfRangeException>(() => OperationCodeFormat.Format("PUJ", Day, 0));
    }

    [Fact]
    public void TheNextCodeFollowsTheHighestOfTheDayAndIgnoresOtherCodes()
    {
        Assert.Equal("PUJ-20261105-001", OperationCodeFormat.Next("PUJ", Day, []));
        Assert.Equal("PUJ-20261105-003", OperationCodeFormat.Next("PUJ", Day,
            ["PUJ-20261105-001", "PUJ-20261105-002", "MAN-5b75550061414bcbbc676a38b0ea1809", "PUJ-20261104-007",
             "SDQ-20261105-009", "PUJ-20261105-ABC"]));
        Assert.Equal("PUJ-20261105-1000", OperationCodeFormat.Next("PUJ", Day, ["PUJ-20261105-999"]));
    }

    [Theory]
    [InlineData("PUJ-20261105-001", 1)]
    [InlineData("PUJ-20261105-1234", 1234)]
    [InlineData("PUJ-20261105-01", null)]
    [InlineData("PUJ-20261105-000", null)]
    [InlineData("PUJ-20261105--01", null)]
    [InlineData("EXT-0123456789abcdef", null)]
    [InlineData(null, null)]
    public void OnlyCodesOfTheDayCount(string? code, int? sequence) =>
        Assert.Equal(sequence, OperationCodeFormat.Sequence(code, OperationCodeFormat.Prefix("PUJ", Day)));
}
