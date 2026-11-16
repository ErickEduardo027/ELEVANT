using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class FinanceTaxCalculatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 18, 12, 0, 0, TimeSpan.Zero);
    private static FinanceTaxPolicy Policy(decimal rate = 17.25m) => WithId(new()
    {
        PublicId = Guid.NewGuid(), AirlineId = 10, StationId = 20, CurrencyCode = "USD",
        ConceptKind = PreinvoiceLineKind.Service, ConceptCode = "GPU", Treatment = FinanceTaxTreatment.Taxable,
        Rate = rate, Status = FinanceTaxPolicyStatus.Published, ValidFrom = new(2026, 1, 1),
    }, 1);
    private static FinanceTaxPolicy WithId(FinanceTaxPolicy policy, long id)
    {
        typeof(FinanceTaxPolicy).GetProperty(nameof(FinanceTaxPolicy.Id))!.SetValue(policy, id);
        return policy;
    }
    private static PreinvoiceLine Line() => new() { Kind = PreinvoiceLineKind.Service, ServiceCode = "GPU",
        OperationDate = new(2026, 10, 18), CurrencyCode = "USD", ExecutedQuantity = 2, UnitPrice = 50, Amount = 100 };

    [Fact]
    public void MissingTreatmentIsUnknownEvenWhenTheProvisionalGrossIsZero()
    {
        var line = Line(); line.Amount = 0;
        FinanceTaxCalculator.Capture(line, null, Now);
        Assert.Equal(FinanceTaxTreatment.Unconfigured, line.TaxTreatment);
        Assert.Null(line.TaxAmount); Assert.Null(line.TaxRate);
        Assert.Equal(0, line.NetAmount); Assert.Equal(0, line.GrossAmount);
        Assert.False(FinanceTaxCalculator.IsConfigured(line));
    }

    [Fact]
    public void ExplicitZeroRateIsConfiguredAndDistinctFromMissing()
    {
        var line = Line(); FinanceTaxCalculator.Capture(line, Policy(0), Now);
        Assert.Equal(0, line.TaxAmount); Assert.Equal(100, line.GrossAmount);
        Assert.True(FinanceTaxCalculator.IsConfigured(line));
    }

    [Theory]
    [InlineData(PreinvoiceLineKind.Service)]
    [InlineData(PreinvoiceLineKind.Charge)]
    [InlineData(PreinvoiceLineKind.Package)]
    [InlineData(PreinvoiceLineKind.Adjustment)]
    [InlineData(PreinvoiceLineKind.Excess)]
    [InlineData(PreinvoiceLineKind.Minimum)]
    public void CapturesFourDecimalAmountsAndPreservesPretaxPrice(PreinvoiceLineKind kind)
    {
        var line = Line(); line.Kind = kind; line.Amount = kind == PreinvoiceLineKind.Adjustment ? -100.1234m : 100.1234m;
        var policy = Policy(); policy.ConceptKind = kind;
        FinanceTaxCalculator.Capture(line, policy, Now);
        Assert.Equal(decimal.Round(line.NetAmount!.Value * .1725m, 4, MidpointRounding.AwayFromZero), line.TaxAmount);
        Assert.Equal(line.NetAmount + line.TaxAmount, line.Amount);
        Assert.Equal(line.Amount, line.GrossAmount); Assert.Equal(50, line.UnitPrice);
        Assert.Equal(0, line.DiscountAmount);
    }

    [Fact]
    public void ResolutionRequiresExactContextAndDetectsOverlappingPolicies()
    {
        var policy = Policy(); var line = Line();
        Assert.Same(policy, FinanceTaxCalculator.Resolve([policy], 10, 20, line));
        Assert.Null(FinanceTaxCalculator.Resolve([policy], 11, 20, line));
        Assert.Null(FinanceTaxCalculator.Resolve([policy], 10, 21, line));
        line.CurrencyCode = "DOP"; Assert.Null(FinanceTaxCalculator.Resolve([policy], 10, 20, line)); line.CurrencyCode = "USD";
        line.Kind = PreinvoiceLineKind.Package; Assert.Null(FinanceTaxCalculator.Resolve([policy], 10, 20, line)); line.Kind = PreinvoiceLineKind.Service;
        policy.ValidTo = new(2026, 10, 17);
        Assert.Null(FinanceTaxCalculator.Resolve([policy], 10, 20, line));
        policy.ValidTo = null;
        var duplicate = WithId(Policy(), 2);
        Assert.Equal("ambiguous_tax_policy", Assert.Throws<FinanceTaxRuleException>(() =>
            FinanceTaxCalculator.Resolve([policy, duplicate], 10, 20, line)).Code);
    }

    [Fact]
    public void ReplacementKeepsHistoryAndOnlyOverridesDuringItsOwnValidity()
    {
        var old = Policy(); var next = WithId(Policy(12), 2); next.ReplacesPolicyId = old.Id;
        next.ValidFrom = new(2026, 10, 1); next.ValidTo = new(2026, 10, 31);
        Assert.Same(next, FinanceTaxCalculator.Resolve([old, next], 10, 20, Line()));
        var line = Line(); line.OperationDate = new(2026, 11, 1);
        Assert.Same(old, FinanceTaxCalculator.Resolve([old, next], 10, 20, line));
    }

    [Theory]
    [InlineData(FinanceTaxTreatment.Exempt)]
    [InlineData(FinanceTaxTreatment.NotSubject)]
    public void NonTaxableTreatmentRequiresAnExplicitBasis(FinanceTaxTreatment treatment)
    {
        var policy = Policy(); policy.Treatment = treatment; policy.Rate = null;
        Assert.Throws<FinanceTaxRuleException>(() => FinanceTaxCalculator.Validate(policy));
        policy.Basis = "Synthetic reviewed basis";
        var line = Line(); FinanceTaxCalculator.Capture(line, policy, Now);
        Assert.True(FinanceTaxCalculator.IsConfigured(line)); Assert.Equal(0, line.TaxAmount);
        Assert.Equal(policy.Basis, line.TaxBasis);
    }

    [Fact]
    public void CaptureOnceAndGrossEditsPreserveTheFrozenPolicyAndRate()
    {
        var line = Line(); var old = Policy(20); FinanceTaxCalculator.Capture(line, old, Now);
        var next = Policy(5); FinanceTaxCalculator.Capture(line, next, Now.AddDays(1));
        Assert.Equal(old.PublicId, line.TaxPolicyPublicId); Assert.Equal(120, line.Amount);
        FinanceTaxCalculator.RepriceGross(line, 60);
        Assert.Equal(50, line.NetAmount); Assert.Equal(10, line.TaxAmount); Assert.Equal(60, line.Amount);
        Assert.Equal(20, line.TaxRate); Assert.Equal(50, line.UnitPrice);
    }

    [Fact]
    public void RestoringComputedValuationRestoresNetTaxAndExclusionWithoutChangingTreatment()
    {
        var line = Line(); line.ComputedAmount = 100;
        FinanceTaxCalculator.Capture(line, Policy(20), Now);
        FinanceTaxCalculator.RepriceGross(line, 60);
        FinanceTaxCalculator.RestoreComputed(line);
        Assert.Equal(100, line.NetAmount); Assert.Equal(20, line.TaxAmount); Assert.Equal(120, line.Amount);
        line.IsExcluded = true; FinanceTaxCalculator.RestoreComputed(line);
        Assert.Equal(0, line.NetAmount); Assert.Equal(0, line.TaxAmount); Assert.Equal(0, line.Amount);
        Assert.Equal(20, line.TaxRate);
    }

    [Fact]
    public void MissingValidityCannotBecomeAnImplicitAllTimeTaxPolicy()
    {
        var policy = Policy(); policy.ValidFrom = default;
        Assert.Equal("invalid_tax_policy", Assert.Throws<FinanceTaxRuleException>(() => FinanceTaxCalculator.Validate(policy)).Code);
    }
}
