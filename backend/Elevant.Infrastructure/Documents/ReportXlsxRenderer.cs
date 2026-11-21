using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Documents;

namespace Elevant.Infrastructure.Documents;

/// <summary>
/// The Excel workbook of a <see cref="ReportDocument"/> (ADR-0048), made to analyse: the title and metadata first, then a
/// navy heading with the panes frozen under it and an autofilter, real numbers with thousands (<c>#,##0.00</c>), dates
/// as Excel dates (<c>dd/mm/yyyy</c>), times, durations and percentages (<c>0.0%</c>), and a totals row with
/// <c>SUBTOTAL(109, …)</c> that follows the filter. It prints landscape fitted to the width with the heading repeated.
/// The sheet is named after the report; a second sheet «Filtros» lists the parameters, the summary and the notes. Text
/// is always an inline string, so a value that looks like a formula never runs.
/// </summary>
internal sealed class ReportXlsxRenderer
{
    internal const string FiltersSheet = "Filtros";

    private static class Style
    {
        public const uint Title = 1, MetaLabel = 2, MetaValue = 3, Header = 4, Text = 5, Integer = 6, Decimal2 = 7,
            Money = 8, Percent = 9, Date = 10, DateTime = 11, Time = 12, Duration = 13, TotalLabel = 14,
            TotalInteger = 15, TotalDecimal2 = 16, TotalDuration = 17, Note = 18, Decimal1 = 19, TotalDecimal1 = 20,
            TotalPercent = 21;
    }

    private static readonly DateTime Epoch = new(1899, 12, 30);

    public byte[] Render(ReportDocument report)
    {
        ArgumentNullException.ThrowIfNull(report);
        report.Validate();
        var sheetName = SheetName(report.Title);
        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, true))
        {
            var workbook = document.AddWorkbookPart();
            workbook.Workbook = new Workbook();
            var styles = workbook.AddNewPart<WorkbookStylesPart>();
            styles.Stylesheet = Stylesheet();
            styles.Stylesheet.Save();

            var reportPart = workbook.AddNewPart<WorksheetPart>();
            var (headerRow, lastRow, lastColumn) = WriteReport(reportPart, report);
            var filtersPart = workbook.AddNewPart<WorksheetPart>();
            WriteFilters(filtersPart, report);

            var sheets = new Sheets(
                new Sheet { Id = workbook.GetIdOfPart(reportPart), SheetId = 1U, Name = sheetName },
                new Sheet { Id = workbook.GetIdOfPart(filtersPart), SheetId = 2U, Name = FiltersSheet });
            var quoted = "'" + sheetName.Replace("'", "''", StringComparison.Ordinal) + "'";
            var definedNames = new DefinedNames(
                new DefinedName($"{quoted}!$A${headerRow}:${lastColumn}${lastRow}")
                {
                    Name = "_xlnm._FilterDatabase", LocalSheetId = 0U, Hidden = true,
                },
                new DefinedName($"{quoted}!${headerRow}:${headerRow}") { Name = "_xlnm.Print_Titles", LocalSheetId = 0U });
            workbook.Workbook.Append(sheets, definedNames, new CalculationProperties { FullCalculationOnLoad = true });
            workbook.Workbook.Save();
        }
        return stream.ToArray();
    }

    /// <summary>The sheet name Excel accepts: the title without <c>[]:*?/\</c>, at most 31 characters.</summary>
    internal static string SheetName(string title)
    {
        var clean = new string(title.Where(character => character is not ('[' or ']' or ':' or '*' or '?' or '/' or '\\') &&
            !char.IsControl(character)).ToArray()).Trim().Trim('\'');
        if (clean.Length > 31) clean = clean[..31].TrimEnd();
        return clean.Length == 0 || string.Equals(clean, FiltersSheet, StringComparison.OrdinalIgnoreCase) ? "Reporte" : clean;
    }

    private static (int HeaderRow, int LastRow, string LastColumn) WriteReport(WorksheetPart part, ReportDocument report)
    {
        var columns = report.Columns;
        var data = new SheetData();
        var rowIndex = 0;
        Row NewRow()
        {
            var row = new Row { RowIndex = (uint)++rowIndex };
            data.Append(row);
            return row;
        }

        NewRow().Append(TextCell(1, rowIndex, report.Title, Style.Title));
        if (report.Description is { Length: > 0 } description) NewRow().Append(TextCell(1, rowIndex, description, Style.Note));
        foreach (var item in report.Metadata)
        {
            var row = NewRow();
            row.Append(TextCell(1, rowIndex, item.Label, Style.MetaLabel), TextCell(2, rowIndex, item.Value, Style.MetaValue));
        }
        if (report.Notice is { } notice) NewRow().Append(TextCell(1, rowIndex, notice, Style.Note));
        NewRow();

        var headerRow = NewRow();
        var header = rowIndex;
        headerRow.Height = 30;
        headerRow.CustomHeight = true;
        for (var column = 0; column < columns.Count; column++)
            headerRow.Append(TextCell(column + 1, rowIndex, columns[column].Heading, Style.Header));

        var decimals = Enumerable.Range(0, columns.Count)
            .Select(index => ReportFormat.DecimalsOf(columns[index], report.Rows.Select(row => row[index]))).ToArray();
        var first = rowIndex + 1;
        foreach (var values in report.Rows)
        {
            var row = NewRow();
            for (var column = 0; column < columns.Count; column++)
                row.Append(ValueCell(column + 1, rowIndex, columns[column], values[column], decimals[column], total: false));
        }
        var last = Math.Max(rowIndex, header);

        foreach (var total in report.Rows.Count == 0 ? [] : report.EffectiveTotals)
        {
            var row = NewRow();
            for (var column = 0; column < columns.Count; column++)
            {
                var cell = total.Cells[column];
                if (cell is null)
                {
                    row.Append(TextCell(column + 1, rowIndex, string.Empty, Style.TotalLabel));
                    continue;
                }
                if (!cell.HasValue || !columns[column].Summable)
                {
                    row.Append(TextCell(column + 1, rowIndex, cell.Text, Style.TotalLabel));
                    continue;
                }
                var letter = ColumnName(column + 1);
                var range = $"{letter}{first}:{letter}{last}";
                var formula = total.Currency is { } currency && columns[column].CurrencyColumn is { } currencyIndex &&
                    report.EffectiveTotals.Count > 1
                    ? $"SUMPRODUCT(SUBTOTAL(109,OFFSET({letter}{first},ROW({range})-ROW({letter}{first}),0))*" +
                      $"({ColumnName(currencyIndex + 1)}{first}:{ColumnName(currencyIndex + 1)}{last}=\"{currency.Replace("\"", "\"\"", StringComparison.Ordinal)}\"))"
                    : $"SUBTOTAL(109,{range})";
                var typed = ValueCell(column + 1, rowIndex, columns[column], cell, decimals[column], total: true);
                typed.CellFormula = new CellFormula(formula);
                row.Append(typed);
            }
        }

        if (report.Rows.Count == 0) NewRow().Append(TextCell(1, rowIndex, ReportPdfRenderer.EmptyState, Style.Note));
        if (report.Notes.Count > 0) NewRow();
        foreach (var note in report.Notes) NewRow().Append(TextCell(1, rowIndex, "Nota: " + note, Style.Note));

        var lastColumn = ColumnName(columns.Count);
        var widths = Widths(report, decimals);
        var worksheet = new Worksheet(
            new SheetProperties(new PageSetupProperties { FitToPage = true }),
            new SheetDimension { Reference = $"A1:{lastColumn}{Math.Max(rowIndex, 1)}" },
            new SheetViews(new SheetView(
                new Pane
                {
                    VerticalSplit = header, TopLeftCell = $"A{header + 1}", ActivePane = PaneValues.BottomLeft,
                    State = PaneStateValues.Frozen,
                },
                new Selection { Pane = PaneValues.BottomLeft, ActiveCell = $"A{header + 1}", SequenceOfReferences = new ListValue<StringValue> { InnerText = $"A{header + 1}" } })
            {
                WorkbookViewId = 0U,
            }),
            new SheetFormatProperties { DefaultRowHeight = 15 },
            new Columns(widths.Select((width, index) => new Column
            {
                Min = (uint)(index + 1), Max = (uint)(index + 1), Width = width, CustomWidth = true,
            })),
            data,
            new AutoFilter { Reference = $"A{header}:{lastColumn}{last}" },
            new PrintOptions { HorizontalCentered = false, GridLines = false },
            new PageMargins { Left = 0.4, Right = 0.4, Top = 0.5, Bottom = 0.5, Header = 0.3, Footer = 0.3 },
            new PageSetup
            {
                PaperSize = 9U, Orientation = OrientationValues.Landscape, FitToWidth = 1U, FitToHeight = 0U,
            },
            new HeaderFooter(new OddFooter($"&L{Escape(report.Title)}&RELEVANT · AVIAM · Uso interno — Página &P de &N")));
        part.Worksheet = worksheet;
        part.Worksheet.Save();
        return (header, last, lastColumn);
    }

    private static string Escape(string value) => value.Replace("&", "&&", StringComparison.Ordinal);

    private static void WriteFilters(WorksheetPart part, ReportDocument report)
    {
        var data = new SheetData();
        var rowIndex = 0;
        void Line(params (string Text, uint Style)[] values)
        {
            var row = new Row { RowIndex = (uint)++rowIndex };
            for (var index = 0; index < values.Length; index++)
                row.Append(TextCell(index + 1, rowIndex, values[index].Text, values[index].Style));
            data.Append(row);
        }

        Line((report.Title, Style.Title));
        Line();
        Line(("Parámetro", Style.Header), ("Valor", Style.Header));
        foreach (var item in report.Metadata) Line((item.Label, Style.MetaLabel), (item.Value, Style.MetaValue));
        if (report.Summary.Count > 0)
        {
            Line();
            Line(("Resumen", Style.Header), ("Valor", Style.Header), ("Contexto", Style.Header));
            foreach (var metric in report.Summary)
                Line((metric.Label, Style.MetaLabel), (metric.Value, Style.MetaValue), (metric.Context ?? string.Empty, Style.MetaValue));
        }
        if (report.Notes.Count > 0 || report.Notice is not null)
        {
            Line();
            Line(("Notas", Style.Header));
            if (report.Notice is { } notice) Line((notice, Style.Note));
            foreach (var note in report.Notes) Line((note, Style.Note));
        }
        part.Worksheet = new Worksheet(
            new Columns(
                new Column { Min = 1U, Max = 1U, Width = 30, CustomWidth = true },
                new Column { Min = 2U, Max = 2U, Width = 70, CustomWidth = true },
                new Column { Min = 3U, Max = 3U, Width = 40, CustomWidth = true }),
            data);
        part.Worksheet.Save();
    }

    /// <summary>Widths in characters from the heading and the printed values, between 8 and 60.</summary>
    private static double[] Widths(ReportDocument report, int[] decimals)
    {
        var sample = report.Rows.Count <= 2000 ? report.Rows : report.Rows.Where((_, index) => index % (report.Rows.Count / 2000 + 1) == 0).ToArray();
        return report.Columns.Select((column, index) =>
        {
            var widest = sample.Select(row => ReportFormat.Display(column, row[index], decimals[index]).Length)
                .DefaultIfEmpty(0).Max();
            var heading = column.Heading.Split(' ').Select(word => word.Length).DefaultIfEmpty(0).Max();
            var full = Math.Min(column.Heading.Length, 24);
            var characters = Math.Max(Math.Max(widest, heading), full) + (column.IsNumeric ? 3 : 2);
            if (index == 0) characters = Math.Max(characters, 16);
            return Math.Round(Math.Clamp(characters * 1.1, 8, 60), 2);
        }).ToArray();
    }

    private static Cell ValueCell(int column, int row, ReportColumn spec, ReportCell value, int decimals, bool total)
    {
        var reference = ColumnName(column) + row.ToString(CultureInfo.InvariantCulture);
        if (value.Number is { } number && spec.IsNumeric)
        {
            var (written, style) = spec.Type switch
            {
                ReportColumnType.Percent => (number / 100m, total ? Style.TotalPercent : Style.Percent),
                ReportColumnType.Duration => (number / 1440m, total ? Style.TotalDuration : Style.Duration),
                ReportColumnType.Money => (decimal.Round(number, 2, MidpointRounding.AwayFromZero),
                    total ? Style.TotalDecimal2 : Style.Money),
                _ => (number, decimals switch
                {
                    0 => total ? Style.TotalInteger : Style.Integer,
                    1 => total ? Style.TotalDecimal1 : Style.Decimal1,
                    _ => total ? Style.TotalDecimal2 : Style.Decimal2,
                }),
            };
            return new Cell
            {
                CellReference = reference, DataType = CellValues.Number, StyleIndex = style,
                CellValue = new CellValue(written.ToString(CultureInfo.InvariantCulture)),
            };
        }
        if (value.Moment is { } moment && spec.Type is ReportColumnType.Date or ReportColumnType.DateTime or ReportColumnType.Time)
        {
            var serial = spec.Type switch
            {
                ReportColumnType.Date => (moment.Date - Epoch).TotalDays,
                ReportColumnType.Time => moment.TimeOfDay.TotalDays,
                _ => (moment - Epoch).TotalDays,
            };
            return new Cell
            {
                CellReference = reference, DataType = CellValues.Number,
                StyleIndex = spec.Type switch
                {
                    ReportColumnType.Date => Style.Date,
                    ReportColumnType.Time => Style.Time,
                    _ => Style.DateTime,
                },
                CellValue = new CellValue(Math.Round(serial, 8).ToString(CultureInfo.InvariantCulture)),
            };
        }
        return TextCell(column, row, value.Text, total ? Style.TotalLabel : Style.Text);
    }

    private static Cell TextCell(int column, int row, string value, uint style) => new()
    {
        CellReference = ColumnName(column) + row.ToString(CultureInfo.InvariantCulture),
        DataType = CellValues.InlineString, StyleIndex = style,
        InlineString = new InlineString(new Text(Clean(value)) { Space = SpaceProcessingModeValues.Preserve }),
    };

    /// <summary>XML 1.0 has no place for control characters other than tab and line breaks.</summary>
    private static string Clean(string value) =>
        new(value.Where(character => !char.IsControl(character) || character is '\t' or '\n' or '\r').ToArray());

    internal static string ColumnName(int index)
    {
        var name = string.Empty;
        for (var value = index; value > 0; value = (value - 1) / 26)
            name = (char)('A' + (value - 1) % 26) + name;
        return name;
    }

    private static Stylesheet Stylesheet()
    {
        var numberFormats = new NumberingFormats(
            new NumberingFormat { NumberFormatId = 164U, FormatCode = "0.0%" },
            new NumberingFormat { NumberFormatId = 165U, FormatCode = "dd/mm/yyyy" },
            new NumberingFormat { NumberFormatId = 166U, FormatCode = "dd/mm/yyyy hh:mm" },
            new NumberingFormat { NumberFormatId = 167U, FormatCode = "hh:mm" },
            new NumberingFormat { NumberFormatId = 168U, FormatCode = "[h]:mm" },
            new NumberingFormat { NumberFormatId = 169U, FormatCode = "#,##0.0" },
            new NumberingFormat { NumberFormatId = 170U, FormatCode = "#,##0.00" });
        numberFormats.Count = (uint)numberFormats.ChildElements.Count;
        Font Font(double size, bool bold = false, string? color = null, bool italic = false)
        {
            var font = new Font();
            if (bold) font.Append(new Bold());
            if (italic) font.Append(new Italic());
            font.Append(new FontSize { Val = size });
            font.Append(color is null ? new Color { Theme = 1U } : new Color { Rgb = color });
            font.Append(new FontName { Val = "Calibri" }, new FontFamilyNumbering { Val = 2 });
            return font;
        }
        var fonts = new Fonts(Font(11), Font(11, bold: true, color: "FF081B3A"), Font(11, bold: true, color: "FFFFFFFF"),
            Font(14, bold: true, color: "FF081B3A"), Font(10, color: "FF4D5D76", italic: true));
        fonts.Count = (uint)fonts.ChildElements.Count;
        Fill Solid(string rgb) => new(new PatternFill(new ForegroundColor { Rgb = rgb }, new BackgroundColor { Indexed = 64U })
        {
            PatternType = PatternValues.Solid,
        });
        var fills = new Fills(new Fill(new PatternFill { PatternType = PatternValues.None }),
            new Fill(new PatternFill { PatternType = PatternValues.Gray125 }), Solid("FF081B3A"), Solid("FFE2EAF5"));
        fills.Count = (uint)fills.ChildElements.Count;
        var borders = new Borders(
            new Border(new LeftBorder(), new RightBorder(), new TopBorder(), new BottomBorder(), new DiagonalBorder()),
            new Border(new LeftBorder(), new RightBorder(), new TopBorder(),
                new BottomBorder(new Color { Rgb = "FF081B3A" }) { Style = BorderStyleValues.Thin }, new DiagonalBorder()),
            new Border(new LeftBorder(), new RightBorder(),
                new TopBorder(new Color { Rgb = "FF081B3A" }) { Style = BorderStyleValues.Medium }, new BottomBorder(),
                new DiagonalBorder()));
        borders.Count = (uint)borders.ChildElements.Count;
        CellFormat Format(uint numberFormat = 0, uint font = 0, uint fill = 0, uint border = 0, bool wrap = false,
            bool right = false)
        {
            var format = new CellFormat
            {
                NumberFormatId = numberFormat, FontId = font, FillId = fill, BorderId = border, FormatId = 0U,
                ApplyNumberFormat = numberFormat != 0, ApplyFont = font != 0, ApplyFill = fill != 0,
                ApplyBorder = border != 0,
            };
            if (wrap || right)
            {
                format.ApplyAlignment = true;
                format.Append(new Alignment
                {
                    WrapText = wrap, Vertical = VerticalAlignmentValues.Center,
                    Horizontal = right ? HorizontalAlignmentValues.Right : null,
                });
            }
            return format;
        }
        var formats = new CellFormats(
            Format(),
            Format(font: 3), // Title
            Format(font: 1), // MetaLabel
            Format(), // MetaValue
            Format(font: 2, fill: 2, border: 1, wrap: true), // Header
            Format(), // Text
            Format(numberFormat: 3U), // Integer #,##0
            Format(numberFormat: 170U), // Decimal2
            Format(numberFormat: 170U), // Money
            Format(numberFormat: 164U), // Percent
            Format(numberFormat: 165U), // Date
            Format(numberFormat: 166U), // DateTime
            Format(numberFormat: 167U), // Time
            Format(numberFormat: 168U), // Duration
            Format(font: 1, fill: 3, border: 2), // TotalLabel
            Format(numberFormat: 3U, font: 1, fill: 3, border: 2), // TotalInteger
            Format(numberFormat: 170U, font: 1, fill: 3, border: 2), // TotalDecimal2
            Format(numberFormat: 168U, font: 1, fill: 3, border: 2), // TotalDuration
            Format(font: 4), // Note
            Format(numberFormat: 169U), // Decimal1
            Format(numberFormat: 169U, font: 1, fill: 3, border: 2), // TotalDecimal1
            Format(numberFormat: 164U, font: 1, fill: 3, border: 2)); // TotalPercent
        formats.Count = (uint)formats.ChildElements.Count;
        return new Stylesheet(numberFormats, fonts, fills, borders,
            new CellStyleFormats(new CellFormat { NumberFormatId = 0U, FontId = 0U, FillId = 0U, BorderId = 0U }) { Count = 1U },
            formats,
            new CellStyles(new CellStyle { Name = "Normal", FormatId = 0U, BuiltinId = 0U }) { Count = 1U });
    }
}
