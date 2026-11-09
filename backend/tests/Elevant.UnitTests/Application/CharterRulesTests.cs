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

    /// <summary>
    /// 4-N22: a correction of a confirmed prepayment states why in 5 to 500 characters, while the reopening of 3-N24 keeps
    /// its 8; the amount is positive, at most 10 000 000 and in cents.
    /// </summary>
    [Fact]
    public void ACorrectionTakesItsReasonAndTheAmountIsInCents()
    {
        Assert.Equal("Monto", CharterRules.NormalizeCorrectionReason("  Monto  "));
        Assert.Null(CharterRules.NormalizeCorrectionReason("Mal"));
        Assert.Null(CharterRules.NormalizeCorrectionReason(new string('x', 501)));
        Assert.Null(CharterRules.NormalizeCorrectionReason("Monto\u0007 mal"));
        Assert.Equal(new string('x', 500), CharterRules.NormalizeCorrectionReason(new string('x', 500)));
        Assert.Null(CharterRules.NormalizeReopenReason("Monto"));
        Assert.Equal("Nueva cotización", CharterRules.NormalizeReopenReason(" Nueva cotización "));
        Assert.True(CharterRules.IsValidPrepaymentAmount(1500m));
        Assert.True(CharterRules.IsValidPrepaymentAmount(0.01m));
        Assert.True(CharterRules.IsValidPrepaymentAmount(10_000_000m));
        Assert.False(CharterRules.IsValidPrepaymentAmount(0m));
        Assert.False(CharterRules.IsValidPrepaymentAmount(10_000_000.01m));
        Assert.False(CharterRules.IsValidPrepaymentAmount(1.005m));
    }

    [Fact]
    public void TextIsTrimmedAndBoundedAndReferencesAreSafe()
    {
        Assert.Equal("1200 NW 72nd Ave", CharterRules.NormalizeText("  1200   NW 72nd Ave ", 300));
        Assert.Null(CharterRules.NormalizeText(new string('x', 301), 300));
        Assert.Equal("TRF-0001", CharterRules.NormalizeReference(" TRF-0001 "));
        Assert.Null(CharterRules.NormalizeReference("<script>"));
    }
}
