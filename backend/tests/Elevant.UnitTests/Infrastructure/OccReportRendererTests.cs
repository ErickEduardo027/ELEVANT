using System.Text;
using DocumentFormat.OpenXml.Packaging;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Operations;

namespace Elevant.UnitTests.Infrastructure;

public sealed class OccReportRendererTests
{
    private static OccReportTable Table(params IReadOnlyList<OccReportCell>[] rows) => new(
        OccReportCatalog.Find("services-by-airline")!, Guid.NewGuid(), "PUJ", new(2026, 8, 1), new(2026, 8, 31),
        new DateTimeOffset(2026, 10, 26, 12, 0, 0, TimeSpan.Zero), rows, 1, 5000, false);

    private static readonly IReadOnlyList<OccReportCell> Row =
    [
        new("Aerolíneas \"Caribe\", S.A."), new("=HYPERLINK(\"x\")"), new("Operación"),
        OccReportCell.Number(2), OccReportCell.Number(3.5m), OccReportCell.Number(-1),
    ];

    [Fact]
    public void CsvIsUtf8WithBomSpanishHeadingsQuotingAndNoFormulas()
    {
        var bytes = new OccReportRenderer().RenderCsv(Table(Row));
        Assert.Equal(Encoding.UTF8.GetPreamble(), bytes[..3]);
        var text = Encoding.UTF8.GetString(bytes[3..]);
        Assert.Contains("Servicios ejecutados por aerolínea", text);
        Assert.Contains("Período: 01/08/2026 – 31/08/2026", text);
        Assert.Contains("Aerolínea,Servicio,Unidad,Operaciones,Cantidad contratada,Cantidad ejecutada", text);
        Assert.Contains("\"Aerolíneas \"\"Caribe\"\", S.A.\",\"'=HYPERLINK(\"\"x\"\")\",Operación,2,3.5,-1", text);
    }

    [Fact]
    public void XlsxKeepsNumbersAsNumbersAndPdfIsAPdf()
    {
        var renderer = new OccReportRenderer();
        using (var document = SpreadsheetDocument.Open(new MemoryStream(renderer.RenderXlsx(Table(Row))), false))
        {
            var cells = document.WorkbookPart!.WorksheetParts.Single().Worksheet.Descendants<DocumentFormat.OpenXml.Spreadsheet.Cell>().ToArray();
            Assert.Contains(cells, cell => cell.CellValue?.Text == "3.5" &&
                cell.DataType!.Value == DocumentFormat.OpenXml.Spreadsheet.CellValues.Number);
        }
        Assert.Equal("%PDF", Encoding.ASCII.GetString(renderer.RenderPdf(Table(Row))[..4]));
        Assert.Equal("%PDF", Encoding.ASCII.GetString(renderer.RenderPdf(Table())[..4]));
    }

    [Fact]
    public void RejectsRowsThatDoNotMatchTheColumns() =>
        Assert.Throws<ArgumentException>(() => new OccReportRenderer().RenderCsv(Table([new OccReportCell("solo una")])));

    [Fact]
    public void CatalogOffersFiveReportsAndLimitsThePeriod()
    {
        Assert.Equal(5, OccReportCatalog.All.Count);
        Assert.True(OccReportCatalog.ValidRange(new(2026, 1, 1), new(2026, 12, 31)));
        Assert.False(OccReportCatalog.ValidRange(new(2026, 2, 1), new(2026, 1, 1)));
        Assert.False(OccReportCatalog.ValidRange(new(2025, 1, 1), new(2026, 6, 1)));
    }
}
