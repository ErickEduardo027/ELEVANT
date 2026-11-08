using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;

namespace Elevant.UnitTests.Application;

/// <summary>The Spanish labels of the Gestión Humana exports (3-N16).</summary>
public sealed class HumanResourcesReportLabelsTests
{
    [Theory]
    [InlineData(HumanResourcesReportKind.Expirations, "Vigencias de habilitaciones y permisos")]
    [InlineData(HumanResourcesReportKind.AccountMovements, "Movimientos de cuenta")]
    [InlineData(HumanResourcesReportKind.StaffDistribution, "Distribución de turnos")]
    [InlineData(HumanResourcesReportKind.QualificationCoverage, "Cobertura de habilitaciones")]
    public void EveryReportHasTheTitleOfItsScreen(HumanResourcesReportKind kind, string title) =>
        Assert.Equal(title, HumanResourcesReportLabels.Title(kind));

    [Fact]
    public void DocumentsAndPermitsReadInSpanish()
    {
        Assert.Equal("Habilitación", HumanResourcesReportLabels.DocumentKind("Qualification"));
        Assert.Equal("Permiso", HumanResourcesReportLabels.DocumentKind("Permit"));
        Assert.Equal("Carnet aeroportuario", HumanResourcesReportLabels.PermitType("AirportId"));
        Assert.Equal("Licencia de conducir en rampa", HumanResourcesReportLabels.PermitType("RampDriverLicense"));
    }

    [Fact]
    public void TheExpirationFiltersReadInSpanishAndAMissingOneIsAll()
    {
        Assert.Equal("Habilitaciones", HumanResourcesReportLabels.DocumentKindFilter("Qualification"));
        Assert.Equal("Permisos", HumanResourcesReportLabels.DocumentKindFilter("Permit"));
        Assert.Equal("Todas", HumanResourcesReportLabels.DocumentKindFilter(null));
        Assert.Equal("Vigentes", HumanResourcesReportLabels.Validity("Current"));
        Assert.Equal("Vencidas", HumanResourcesReportLabels.Validity("Expired"));
        Assert.Equal("Todas", HumanResourcesReportLabels.Validity(""));
    }

    [Theory]
    [InlineData("Created", "Alta de cuenta")]
    [InlineData("Deactivated", "Cuenta desactivada")]
    [InlineData("Reactivated", "Cuenta reactivada")]
    public void AccountMovementsReadInSpanish(string movement, string label) =>
        Assert.Equal(label, HumanResourcesReportLabels.Movement(movement));

    [Fact]
    public void AnUnknownCodeIsWrittenAsItIs()
    {
        Assert.Equal("Medical", HumanResourcesReportLabels.DocumentKind("Medical"));
        Assert.Equal("Passport", HumanResourcesReportLabels.PermitType("Passport"));
        Assert.Equal("Suspended", HumanResourcesReportLabels.Movement("Suspended"));
        Assert.Equal("Archived", HumanResourcesReportLabels.Validity("Archived"));
        Assert.Equal(string.Empty, HumanResourcesReportLabels.Movement(null));
    }
}
