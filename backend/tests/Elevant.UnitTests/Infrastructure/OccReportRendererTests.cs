using System.Text;
using DocumentFormat.OpenXml.Packaging;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Operations;
using Elevant.UnitTests.Application;

namespace Elevant.UnitTests.Infrastructure;

public sealed class OccReportRendererTests
{
    private static OccReportTable Table(params IReadOnlyList<OccReportCell>[] rows) => new(
        OccReportCatalog.Find("services-by-airline")!, Guid.NewGuid(), "PUJ", new(2026, 8, 1), new(2026, 8, 31),
        new DateTimeOffset(2026, 10, 26, 12, 0, 0, TimeSpan.Zero), rows, 1, 5000, false)
    {
        TimeZoneId = "America/Santo_Domingo",
    };

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
    public void EveryFormatSaysWhenItWasGeneratedInTheStationsLocalTimeAndHowManyRowsItHas()
    {
        // 12:00Z is 08:00 in Punta Cana (3-N26); the PDF prints the same heading as the CSV and the Excel.
        var renderer = new OccReportRenderer();
        var csv = Encoding.UTF8.GetString(renderer.RenderCsv(Table(Row, Row))[3..]);
        Assert.Contains("Generado: 26/10/2026 08:00 (hora local)", csv);
        Assert.Contains("Filas: 2", csv);
        Assert.DoesNotContain("UTC", csv);
        var pdf = PdfFontInspector.Text(renderer.RenderPdf(Table(Row, Row)));
        Assert.Contains("Generado: 26/10/2026 08:00 (hora local)", pdf);
        Assert.Contains("Filas: 2", pdf);
        // Without a zone the heading uses AVIAM's calendar, never the host's.
        var unzoned = Table(Row) with { TimeZoneId = null };
        Assert.Contains("Generado: 26/10/2026 08:00 (hora local)",
            Encoding.UTF8.GetString(renderer.RenderCsv(unzoned)[3..]));
        Assert.Contains("Sin datos para el período seleccionado.", PdfFontInspector.Text(renderer.RenderPdf(Table())));
    }

    [Fact]
    public void ANumberDropsTheTrailingZerosOfItsStoredScale()
    {
        Assert.Equal("1", OccReportCell.Number(1.0000m).Value);
        Assert.Equal("2.5", OccReportCell.Number(2.5000m).Value);
        Assert.Equal("-1", OccReportCell.Number(-1m).Value);
        Assert.Equal("0.125", OccReportCell.Number(0.1250m).Value);
        Assert.Equal("25000", OccReportCell.Number(25000m).Value);
        Assert.Equal(OccReportCellType.Number, OccReportCell.Number(3m).Type);
    }

    [Fact]
    public void RejectsRowsThatDoNotMatchTheColumns() =>
        Assert.Throws<ArgumentException>(() => new OccReportRenderer().RenderCsv(Table([new OccReportCell("solo una")])));

    [Fact]
    public void CatalogOffersSixReportsAndLimitsThePeriod()
    {
        Assert.Equal(6, OccReportCatalog.All.Count);
        Assert.Equal("daily-close", OccReportCatalog.Find("daily-close")?.Key);
        Assert.True(OccReportCatalog.ValidRange(new(2026, 1, 1), new(2026, 12, 31)));
        Assert.False(OccReportCatalog.ValidRange(new(2026, 2, 1), new(2026, 1, 1)));
        Assert.False(OccReportCatalog.ValidRange(new(2025, 1, 1), new(2026, 6, 1)));
    }
}
