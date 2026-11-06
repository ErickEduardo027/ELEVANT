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
            "Clase: Qualification; Vigencia: Current" &&
            cell.DataType?.Value == CellValues.InlineString);
        Assert.Equal(101, cells.Count(cell => cell.InnerText == "2099-12-31"));
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
