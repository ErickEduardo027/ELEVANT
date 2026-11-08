using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Identity;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Application;

public sealed class HumanResourcesReportRendererTests
{
    [Fact]
    public void XlsxContainsEveryRowAndKeepsFormulaLikeNamesAsText()
    {
        var snapshot = Snapshot(101, "=SUM(1,1)") with
        {
            DocumentKind = "Qualification", Validity = "Current",
        };

        var bytes = new HumanResourcesReportXlsxRenderer().Render(snapshot, "PUJ");

        using var stream = new MemoryStream(bytes);
        using var spreadsheet = SpreadsheetDocument.Open(stream, false);
        var worksheet = Assert.Single(spreadsheet.WorkbookPart!.WorksheetParts);
        var rows = Assert.IsType<Worksheet>(worksheet.Worksheet).Descendants<Row>().ToArray();
        Assert.True(rows.Length >= 102);
        var cells = rows.SelectMany(row => row.Elements<Cell>()).ToArray();
        Assert.DoesNotContain(cells, cell => cell.CellFormula is not null);
        Assert.Contains(cells, cell => cell.InnerText == "=SUM(1,1)" &&
            cell.DataType?.Value == CellValues.InlineString);
        Assert.Contains(cells, cell => cell.InnerText ==
            "Clase: Habilitaciones · Vigencia: Vigentes" &&
            cell.DataType?.Value == CellValues.InlineString);
        Assert.Equal(101, cells.Count(cell => cell.InnerText == "2099-12-31"));
    }

    [Fact]
    public void XlsxHeadingIsSpanishAndSaysWhenItWasGeneratedInTheStationsLocalTime()
    {
        // 12:00Z is 08:00 in Punta Cana (3-N16); the filter codes stay in the snapshot for the audit only.
        var snapshot = Snapshot(1, "Agente") with
        {
            DocumentKind = "Qualification", Validity = "Current", TimeZone = "America/Santo_Domingo",
        };
        using var stream = new MemoryStream(new HumanResourcesReportXlsxRenderer().Render(snapshot, "PUJ"));
        using var spreadsheet = SpreadsheetDocument.Open(stream, false);
        var texts = spreadsheet.WorkbookPart!.WorksheetParts.Single().Worksheet!.Descendants<Cell>()
            .Select(cell => cell.InnerText).ToArray();
        Assert.Contains("Vigencias de habilitaciones y permisos", texts);
        Assert.Contains("Período: 02/12/2099 – 31/12/2099", texts);
        Assert.Contains("Clase: Habilitaciones · Vigencia: Vigentes", texts);
        Assert.Contains("Generado: 05/10/2026 08:00 (hora local)", texts);
        Assert.DoesNotContain(texts, text => text.Contains("Qualification", StringComparison.Ordinal) ||
            text.Contains("Current", StringComparison.Ordinal) || text.Contains("UTC", StringComparison.Ordinal));
    }

    [Fact]
    public void PdfTitleFiltersAndGenerationTimeAreSpanishAndLocal()
    {
        var snapshot = Snapshot(1, "Agente de prueba") with
        {
            DocumentKind = "Permit", TimeZone = "America/Santo_Domingo",
        };
        var bytes = new HumanResourcesReportPdfRenderer().Render(snapshot, "PUJ");
        using (var report = PdfReader.Open(new MemoryStream(bytes), PdfDocumentOpenMode.Import))
            Assert.Equal("Vigencias de habilitaciones y permisos · PUJ", report.Info.Title);
        var text = PdfFontInspector.Text(bytes);
        Assert.Contains("Vigencias de habilitaciones y permisos · PUJ", text);
        Assert.Contains("Período 02/12/2099 – 31/12/2099", text);
        Assert.Contains("Generado 05/10/2026 08:00 (hora local)", text);
        Assert.Contains("1 fila", text);
        Assert.Contains("Clase: Permisos · Vigencia: Todas", text);
        Assert.DoesNotContain("Expirations", text, StringComparison.Ordinal);
        Assert.DoesNotContain("UTC", text, StringComparison.Ordinal);
    }

    [Fact]
    public void AnEmptyPdfSaysThereAreNoRowsForTheFilters()
    {
        var snapshot = new HumanResourcesReportSnapshot(HumanResourcesReportKind.AccountMovements, Guid.NewGuid(),
            new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 30),
            new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero),
            ["Fecha y hora local", "Agente", "Empleado", "Movimiento"], []);
        var text = PdfFontInspector.Text(new HumanResourcesReportPdfRenderer().Render(snapshot, "PUJ"));
        Assert.Contains("Movimientos de cuenta · PUJ", text);
        Assert.Contains("No hay filas para estos filtros.", text);
        Assert.Contains("0 filas", text);
        // Without a zone the time is AVIAM's calendar, never the host's.
        Assert.Contains("Generado 05/10/2026 08:00 (hora local)", text);
    }

    [Theory]
    [InlineData("=SUM(1,1)")]
    [InlineData("+cmd")]
    [InlineData("-cmd")]
    [InlineData("@formula")]
    public void EverySpreadsheetFormulaPrefixRemainsInertText(string value)
    {
        var bytes = new HumanResourcesReportXlsxRenderer().Render(
            Snapshot(1, value), "PUJ");
        using var stream = new MemoryStream(bytes);
        using var spreadsheet = SpreadsheetDocument.Open(stream, false);
        var worksheet = Assert.IsType<Worksheet>(spreadsheet.WorkbookPart!
            .WorksheetParts.Single().Worksheet);
        var cells = worksheet.Descendants<Cell>().ToArray();
        Assert.DoesNotContain(cells, cell => cell.CellFormula is not null);
        Assert.Contains(cells, cell => cell.InnerText == value &&
            cell.DataType?.Value == CellValues.InlineString);
    }

    [Fact]
    public void PdfPaginatesFullSnapshotAndCoexistsWithFinancialDocuments()
    {
        var snapshot = Snapshot(101, "Agente de prueba");

        var bytes = new HumanResourcesReportPdfRenderer().Render(snapshot, "PUJ");
        using var report = PdfReader.Open(new MemoryStream(bytes), PdfDocumentOpenMode.Import);
        Assert.True(report.PageCount > 1);
        Assert.Contains("PUJ", report.Info.Title);
        var payment = new NonFiscalPaymentData(Guid.NewGuid(), Guid.NewGuid(),
            "DEV-PAY-REPORT-001", "USD", 10m,
            new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero));
        var receipt = new FinancialDocumentPdfRenderer().RenderReceipt(payment,
            "DEV-NF-REPORT-001");
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(receipt, 0, 5));
    }

    [Fact]
    public void PdfWrapsLongCellsWithoutDiscardingCharactersOrRows()
    {
        var renderer = new HumanResourcesReportPdfRenderer();
        using var measureDocument = new PdfDocument();
        var measurePage = measureDocument.AddPage();
        using var graphics = XGraphics.FromPdfPage(measurePage);
        var font = ElevantPdfFonts.Regular(8);
        var name = string.Concat(Enumerable.Repeat("NombreCompletoDeAgente", 80));
        var lines = HumanResourcesReportPdfRenderer.WrapCellText(graphics, name, font, 100);
        Assert.True(lines.Count > 40);
        Assert.Equal(name, string.Concat(lines));
        Assert.All(lines, line => Assert.True(graphics.MeasureString(line, font).Width <= 93));

        var snapshot = new HumanResourcesReportSnapshot(
            HumanResourcesReportKind.StaffDistribution, Guid.NewGuid(),
            new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 5),
            new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero),
            ["Fecha", "Agente", "Empleado", "Terminal", "Puesto", "Inicio", "Fin"],
            [(IReadOnlyList<HumanResourcesReportCell>)[
                new("2026-10-05", HumanResourcesReportCellType.Date),
                new(name, HumanResourcesReportCellType.Text),
                new("DEV-001", HumanResourcesReportCellType.Text),
                new("PUJ-A", HumanResourcesReportCellType.Text),
                new("P-1", HumanResourcesReportCellType.Text),
                new("08:00", HumanResourcesReportCellType.Text),
                new("16:00", HumanResourcesReportCellType.Text),
            ]]);
        using var rendered = PdfReader.Open(new MemoryStream(renderer.Render(snapshot, "PUJ")),
            PdfDocumentOpenMode.Import);
        Assert.True(rendered.PageCount > 1);
    }

    private static HumanResourcesReportSnapshot Snapshot(int count, string firstName) =>
        new(HumanResourcesReportKind.Expirations, Guid.NewGuid(),
            new DateOnly(2099, 12, 2), new DateOnly(2099, 12, 31),
            new DateTimeOffset(2026, 10, 5, 12, 0, 0, TimeSpan.Zero),
            ["Agente", "Vence"], Enumerable.Range(0, count).Select(index =>
                (IReadOnlyList<HumanResourcesReportCell>)[
                    new(index == 0 ? firstName : $"Agente {index:000}",
                        HumanResourcesReportCellType.Text),
                    new("2099-12-31", HumanResourcesReportCellType.Date),
                ]).ToArray());
}
