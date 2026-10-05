using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Identity;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Application;

public sealed class HumanResourcesReportRendererTests
{
    [Fact]
    public void XlsxContainsEveryRowAndKeepsFormulaLikeNamesAsText()
    {
        var snapshot = Snapshot(101, "=SUM(1,1)");

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
        Assert.Equal(101, cells.Count(cell => cell.InnerText == "2099-12-31"));
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
