using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>The Spanish labels the OCC reports write (3-N26), the same texts as the web and the tablet.</summary>
public sealed class OperationLabelsTests
{
    [Theory]
    [InlineData(GroundOperationStatus.Planned, "Planificada")]
    [InlineData(GroundOperationStatus.Assigned, "Asignada")]
    [InlineData(GroundOperationStatus.InProgress, "En curso")]
    [InlineData(GroundOperationStatus.PendingReview, "Pendiente de revisión")]
    [InlineData(GroundOperationStatus.InReview, "En revisión")]
    [InlineData(GroundOperationStatus.Approved, "Aprobada")]
    [InlineData(GroundOperationStatus.Returned, "Devuelta")]
    [InlineData(GroundOperationStatus.Cancelled, "Cancelada")]
    public void EveryOperationStateHasItsSpanishLabel(GroundOperationStatus status, string label) =>
        Assert.Equal(label, OperationLabels.Status(status));

    [Fact]
    public void EveryStateAndSeverityIsTranslated()
    {
        Assert.All(Enum.GetValues<GroundOperationStatus>(), status =>
            Assert.NotEqual(status.ToString(), OperationLabels.Status(status)));
        Assert.Equal(["Baja", "Media", "Alta", "Crítica"],
            Enum.GetValues<IncidentSeverity>().Select(OperationLabels.Severity));
    }

    [Theory]
    [InlineData("Operational", "Operativa")]
    [InlineData("Safety", "Seguridad")]
    [InlineData("Equipment", "Equipo")]
    [InlineData("Documentation", "Documentación")]
    [InlineData("Deviation", "Desviación")]
    [InlineData(" Safety ", "Seguridad")]
    [InlineData("Wildlife", "Wildlife")]
    [InlineData("", "—")]
    [InlineData(null, "—")]
    public void IncidentTypesUseTheTabletTextsAndKeepAnUnknownCode(string? type, string label) =>
        Assert.Equal(label, OperationLabels.IncidentType(type));

    [Fact]
    public void AnIncidentReadsItsTypeAndItsSeverityInLowerCase()
    {
        Assert.Equal("Seguridad (alta)", OperationLabels.Incident("Safety", IncidentSeverity.High));
        Assert.Equal("Desviación (crítica)", OperationLabels.Incident("Deviation", IncidentSeverity.Critical));
        Assert.Equal("Operativa (baja)", OperationLabels.Incident("Operational", IncidentSeverity.Low));
    }

    [Theory]
    [InlineData("operation", "Operación")]
    [InlineData("OPERATION", "Operación")]
    [InlineData("hour", "Hora")]
    [InlineData("day", "Día")]
    [InlineData("pallet", "pallet")]
    [InlineData(" ", "—")]
    [InlineData(null, "—")]
    public void ABillingUnitWithoutItsCatalogRowUsesTheVocabularyOfContractsAndPortal(string? code, string label) =>
        Assert.Equal(label, OperationLabels.BillingUnit(code));
}
