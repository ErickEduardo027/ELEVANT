using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Documents;
using Elevant.Infrastructure.Documents;
using Elevant.UnitTests.Application;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>ADR-0048: the common report engine's PDF and Excel, read back.</summary>
public sealed class ReportEngineTests
{
    private static readonly DateTimeOffset At = new(2026, 10, 26, 12, 0, 0, TimeSpan.Zero);

    private static ReportDocument Document(int rows, int extraColumns = 0)
    {
        IReadOnlyList<ReportColumn> columns =
        [
            new("Fecha", ReportColumnType.Date), ReportColumn.Text("Aerolínea"), ReportColumn.Text("Moneda"),
            ReportColumn.Number("Facturas", summable: true), ReportColumn.Money("Total", currencyColumn: 2),
            new("Cobrado", ReportColumnType.Percent),
            .. Enumerable.Range(1, extraColumns).Select(index => ReportColumn.Text($"Columna adicional {index}")),
        ];
        var data = Enumerable.Range(0, rows).Select(index => (IReadOnlyList<ReportCell>)
        [
            ReportCell.Date(new DateOnly(2026, 10, 1).AddDays(index % 28)),
            ReportCell.Of(index % 3 == 0 ? "Aerolíneas \"Caribe\" de Transporte Aéreo Internacional, S.A." : "=HYPERLINK(\"x\")"),
            ReportCell.Of(index % 2 == 0 ? "USD" : "DOP"), ReportCell.Value(index + 1), ReportCell.Value(1234.5m * (index + 1)),
            ReportCell.Value(12.25m),
            .. Enumerable.Range(1, extraColumns).Select(_ => ReportCell.Of("valor")),
        ]).ToArray();
        return new ReportDocument("Finanzas", "Cuentas por cobrar y antigüedad", columns, data)
        {
            Description = "Saldo pendiente por aerolínea en tramos de vencimiento.",
            StationCode = "PUJ", StationName = "Aeropuerto Internacional de Punta Cana",
            From = new DateOnly(2026, 10, 1), To = new DateOnly(2026, 10, 31),
            Filters = [new("Aerolínea", "Arajet"), new("Moneda", "Todas")],
            GeneratedAt = At, TimeZoneId = "America/Santo_Domingo", GeneratedBy = "Ana Pérez",
            Summary = [new("Vencido USD", "USD 1,200.00", "12.5 % del saldo por cobrar")],
            Notes = ["Antigüedad al corte del período."],
        };
    }

    [Fact]
    public void ThePdfNamesItsFiltersWhoGeneratedItTheTotalsAndThePages()
    {
        var pdf = new ReportRenderer().RenderPdf(Document(3));
        var text = PdfFontInspector.Text(pdf);
        Assert.Contains("FINANZAS", text);
        Assert.Contains("Cuentas por cobrar y antigüedad", text);
        Assert.Contains("PUJ · Aeropuerto Internacional de Punta Cana", text);
        Assert.Contains("01/10/2026 – 31/10/2026", text);
        Assert.Contains("Arajet", text);
        Assert.Contains("el 26/10/2026 08:00 (hora local de la estación) por Ana Pérez", text);
        Assert.Contains("12.5 % del saldo por cobrar", text);
        // Thousands, two decimals, one decimal in percentages, a totals row per currency.
        Assert.Contains("1,234.50", text);
        Assert.Contains("12.3 %", text);
        Assert.Contains("Total DOP", text);
        Assert.Contains("Total USD", text);
        Assert.Contains("ELEVANT · AVIAM · Uso interno — Página 1 de 1", text);
        Assert.DoesNotContain("...", text);
        Assert.DoesNotContain("…", text);
        Assert.DoesNotContain("Estación filtrada", text);
    }

    [Fact]
    public void ALongPdfRepeatsTheHeadingOnEveryPageAndCountsThePages()
    {
        var pdf = new ReportRenderer().RenderPdf(Document(160));
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.True(document.PageCount > 2);
        // Six columns or more turn the page.
        Assert.True(document.Pages[0].Width.Point > document.Pages[0].Height.Point);
        var text = PdfFontInspector.Text(pdf);
        Assert.Contains($"Página {document.PageCount} de {document.PageCount}", text);
        Assert.Equal(document.PageCount - 1, CountOf(text, "(continuación)"));
        Assert.Equal(document.PageCount, CountOf(text, "Facturas\n") + CountOf(text, "Facturas\r\n"));
        // Every long airline name is whole: wrapped by word, never cut.
        Assert.DoesNotContain("...", text);
    }

    [Fact]
    public void AnEmptyPdfSaysSoAndAFewColumnsStayPortrait()
    {
        var narrow = new ReportDocument("Gestión Humana", "Movimientos de cuenta",
            [ReportColumn.Text("Agente"), ReportColumn.Text("Movimiento")], []) { GeneratedAt = At, StationCode = "PUJ" };
        var pdf = new ReportRenderer().RenderPdf(narrow);
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.True(document.Pages[0].Height.Point > document.Pages[0].Width.Point);
        Assert.Contains("No hay datos para estos filtros.", PdfFontInspector.Text(pdf));
    }

    [Fact]
    public void TextWrapsByWordAndBreaksOnlyAWordWiderThanTheColumn()
    {
        using var measure = PdfSharp.Drawing.XGraphics.CreateMeasureContext(new PdfSharp.Drawing.XSize(600, 800),
            PdfSharp.Drawing.XGraphicsUnit.Point, PdfSharp.Drawing.XPageDirection.Downwards);
        var font = Elevant.Infrastructure.Finance.ElevantPdfFonts.Regular(8);
        var lines = PdfTextLayout.Wrap(measure, "Aerolíneas del Caribe de Transporte Aéreo Internacional", font, 70);
        Assert.True(lines.Count > 1);
        Assert.All(lines, line => Assert.Equal(line.Trim(), line));
        Assert.Equal("Aerolíneas del Caribe de Transporte Aéreo Internacional", string.Join(' ', lines));
        var hash = new string('A', 120);
        var broken = PdfTextLayout.Wrap(measure, hash, font, 60);
        Assert.Equal(hash, string.Concat(broken));
        Assert.All(broken, line => Assert.True(measure.MeasureString(line, font).Width <= 60));
    }

    [Fact]
    public void TheWorkbookIsStyledFrozenFilteredAndTyped()
    {
        var bytes = new ReportRenderer().RenderXlsx(Document(4));
        using var book = SpreadsheetDocument.Open(new MemoryStream(bytes), false);
        // The schema Excel opens without repairing.
        Assert.Empty(new DocumentFormat.OpenXml.Validation.OpenXmlValidator().Validate(book)
            .Select(error => $"{error.Path?.XPath}: {error.Description}"));
        var workbook = book.WorkbookPart!;
        var sheets = workbook.Workbook.Sheets!.Elements<Sheet>().ToArray();
        Assert.Equal(["Cuentas por cobrar y antigüedad", "Filtros"], sheets.Select(sheet => sheet.Name!.Value).ToArray());
        var sheet = ((WorksheetPart)workbook.GetPartById(sheets[0].Id!)).Worksheet;
        var styles = workbook.WorkbookStylesPart!.Stylesheet;

        // The heading: bold white on navy, the panes frozen under it and an autofilter over the data.
        var header = sheet.Descendants<Row>().First(row => row.Elements<Cell>().Any(cell => cell.InnerText == "Facturas"));
        var headerFormat = (CellFormat)styles.CellFormats!.ElementAt((int)header.Elements<Cell>().First().StyleIndex!.Value);
        var headerFont = (Font)styles.Fonts!.ElementAt((int)headerFormat.FontId!.Value);
        Assert.NotNull(headerFont.Bold);
        Assert.Equal("FFFFFFFF", headerFont.Color!.Rgb!.Value);
        var headerFill = (Fill)styles.Fills!.ElementAt((int)headerFormat.FillId!.Value);
        Assert.Equal("FF081B3A", headerFill.PatternFill!.ForegroundColor!.Rgb!.Value);
        var pane = sheet.Descendants<Pane>().Single();
        Assert.Equal(PaneStateValues.Frozen, pane.State!.Value);
        Assert.Equal((double)header.RowIndex!.Value, pane.VerticalSplit!.Value);
        Assert.Equal($"A{header.RowIndex!.Value}:F{header.RowIndex!.Value + 4}", sheet.Descendants<AutoFilter>().Single().Reference!.Value);
        Assert.Contains(workbook.Workbook.DefinedNames!.Elements<DefinedName>(), name => name.Name == "_xlnm.Print_Titles");
        Assert.Equal(OrientationValues.Landscape, sheet.Descendants<PageSetup>().Single().Orientation!.Value);
        Assert.Equal(1U, sheet.Descendants<PageSetup>().Single().FitToWidth!.Value);
        Assert.All(sheet.Descendants<Column>(), column => Assert.True(column.Width!.Value >= 8));

        // Real numbers, dates and percentages with their format; text stays inline and never a formula.
        string FormatOf(Cell cell)
        {
            var format = (CellFormat)styles.CellFormats!.ElementAt((int)cell.StyleIndex!.Value);
            var id = format.NumberFormatId!.Value;
            return styles.NumberingFormats!.Elements<NumberingFormat>().FirstOrDefault(item => item.NumberFormatId! == id)
                ?.FormatCode!.Value ?? $"builtin:{id}";
        }
        var data = sheet.Descendants<Row>().Single(row => row.RowIndex! == header.RowIndex!.Value + 1).Elements<Cell>().ToArray();
        Assert.Equal("dd/mm/yyyy", FormatOf(data[0]));
        Assert.Equal("46296", data[0].CellValue!.Text);
        Assert.Equal(CellValues.InlineString, data[1].DataType!.Value);
        Assert.Equal("#,##0.00", FormatOf(data[4]));
        Assert.Equal("1234.5", data[4].CellValue!.Text);
        Assert.Equal("0.0%", FormatOf(data[5]));
        Assert.Equal("0.1225", data[5].CellValue!.Text);
        Assert.Contains(sheet.Descendants<Cell>(), cell => cell.InnerText == "=HYPERLINK(\"x\")" &&
            cell.DataType!.Value == CellValues.InlineString && cell.CellFormula is null);

        // Totals that follow the filter: one row per currency, SUBTOTAL(109, …) inside.
        var formulas = sheet.Descendants<CellFormula>().Select(formula => formula.Text).ToArray();
        Assert.NotEmpty(formulas);
        Assert.All(formulas, formula => Assert.Contains("SUBTOTAL(109,", formula));
        Assert.Contains(formulas, formula => formula.Contains("=\"USD\"", StringComparison.Ordinal));
        Assert.Contains(sheet.Descendants<Cell>(), cell => cell.InnerText == "Total USD");

        // The «Filtros» sheet names every parameter.
        var filters = ((WorksheetPart)workbook.GetPartById(sheets[1].Id!)).Worksheet.Descendants<Cell>()
            .Select(cell => cell.InnerText).ToArray();
        Assert.Contains("Arajet", filters);
        Assert.Contains("PUJ · Aeropuerto Internacional de Punta Cana", filters);
        Assert.Contains(filters, text => text.Contains("por Ana Pérez", StringComparison.Ordinal));
        Assert.Contains("12.5 % del saldo por cobrar", filters);
    }

    [Fact]
    public void ASingleCurrencyTotalIsAPlainSubtotal()
    {
        var single = Document(2) with
        {
            Rows = Document(2).Rows.Select(row => (IReadOnlyList<ReportCell>)row.Select((cell, index) =>
                index == 2 ? ReportCell.Of("USD") : cell).ToArray()).ToArray(),
        };
        using var book = SpreadsheetDocument.Open(new MemoryStream(new ReportRenderer().RenderXlsx(single)), false);
        var formulas = book.WorkbookPart!.WorksheetParts.SelectMany(part => part.Worksheet.Descendants<CellFormula>())
            .Select(formula => formula.Text).ToArray();
        Assert.Contains(formulas, formula => formula.StartsWith("SUBTOTAL(109,E", StringComparison.Ordinal));
        Assert.Contains(formulas, formula => formula.StartsWith("SUBTOTAL(109,D", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("Cuentas por cobrar y antigüedad", "Cuentas por cobrar y antigüedad")]
    [InlineData("Ventas: e-CF [simulado] / período?", "Ventas e-CF simulado  período")]
    [InlineData("Revisiones, devoluciones e incidencias del período", "Revisiones, devoluciones e inci")]
    [InlineData("Filtros", "Reporte")]
    public void TheSheetIsNamedAfterTheReportAsExcelAllows(string title, string expected) =>
        Assert.Equal(expected, ReportXlsxRenderer.SheetName(title));

    private static int CountOf(string text, string value)
    {
        var count = 0;
        for (var index = text.IndexOf(value, StringComparison.Ordinal); index >= 0;
             index = text.IndexOf(value, index + value.Length, StringComparison.Ordinal))
            count++;
        return count;
    }
}
