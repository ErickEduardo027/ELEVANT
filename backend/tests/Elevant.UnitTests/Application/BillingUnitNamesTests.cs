using Elevant.Application.Finance;

namespace Elevant.UnitTests.Application;

/// <summary>Unit codes in the whole commercial cycle and the legacy unit names that map to them (1-E).</summary>
public sealed class BillingUnitNamesTests
{
    private static readonly BillingUnitName[] Units =
        [new("operation", "Operación"), new("hour", "Hora"), new("ton", "Tonelada"), new("day", "Día")];

    [Theory]
    [InlineData("operation", "operation")]
    [InlineData(" Operation ", "operation")]
    [InlineData("operación", "operation")]
    [InlineData("Operación", "operation")]
    [InlineData("OPERACION", "operation")]
    [InlineData("hora", "hour")]
    [InlineData("dia", "day")]
    [InlineData("  Tonelada  ", "ton")]
    public void ACodeOrANameInAnyCasingNamesTheActiveUnit(string text, string code) =>
        Assert.Equal(code, BillingUnitNames.Resolve(text, Units));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("galón")]
    [InlineData("turno")]
    [InlineData("operaciones")]
    public void AnUnknownTextNamesNoUnit(string? text) => Assert.Null(BillingUnitNames.Resolve(text, Units));

    [Fact]
    public void ANewLineFallsBackToOperationAndThenToTheFirstActiveCode()
    {
        Assert.Equal("hour", BillingUnitNames.CodeOrDefault("Hora", Units));
        Assert.Equal("operation", BillingUnitNames.CodeOrDefault("turno", Units));
        Assert.Equal("operation", BillingUnitNames.CodeOrDefault(null, Units));
        // Without an active «operation» the first active code applies; with no unit at all, the default code.
        Assert.Equal("day", BillingUnitNames.CodeOrDefault("turno", [new("ton", "Tonelada"), new("day", "Día")]));
        Assert.Equal(BillingUnitNames.DefaultCode, BillingUnitNames.CodeOrDefault("turno", []));
    }
}
