using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class CharterRulesTests
{
    [Theory]
    [InlineData(" pa 123 4567 ", "PA1234567")]
    [InlineData("001-1234567-8", "001-1234567-8")]
    [InlineData("A1", null)]
    [InlineData("PA#123456", null)]
    public void IdentificationIsPrintedAsTheDocumentShowsIt(string input, string? expected) =>
        Assert.Equal(expected, CharterRules.NormalizeIdentification(input));

    [Theory]
    [InlineData(1, true)]
    [InlineData(2.5, true)]
    [InlineData(0, false)]
    [InlineData(1000, false)]
    [InlineData(1.005, false)]
    public void QuantitiesArePositiveWithTwoDecimals(decimal quantity, bool valid) =>
        Assert.Equal(valid, CharterRules.IsValidQuantity(quantity));

    [Fact]
    public void TheServiceRequestIsSignedByTheCarrierAndAviam() =>
        Assert.Equal([OperationSignatureRole.AirlineRepresentative, OperationSignatureRole.AviamAgent],
            OperationDocumentRules.RolesFor(OperationDocumentKind.CharterServiceRequest));

    [Fact]
    public void TextIsTrimmedAndBoundedAndReferencesAreSafe()
    {
        Assert.Equal("1200 NW 72nd Ave", CharterRules.NormalizeText("  1200   NW 72nd Ave ", 300));
        Assert.Null(CharterRules.NormalizeText(new string('x', 301), 300));
        Assert.Equal("TRF-0001", CharterRules.NormalizeReference(" TRF-0001 "));
        Assert.Null(CharterRules.NormalizeReference("<script>"));
    }
}
