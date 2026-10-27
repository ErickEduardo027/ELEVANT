using System.Globalization;
using System.Text;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Spreadsheet;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Identity;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Operations;

/// <summary>
/// Renders an OCC report table. Every format carries the same heading (report, station, period,
/// generation time and row count) and Spanish column titles; CSV is UTF-8 with BOM so Excel opens
/// accents correctly.
/// </summary>
public sealed class OccReportRenderer : IOccReportRenderer
{
    static OccReportRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public byte[] RenderCsv(OccReportTable table)
    {
        Validate(table);
        var text = new StringBuilder();
        foreach (var line in Heading(table)) text.Append(Csv(line)).Append("\r\n");
        text.Append("\r\n").Append(string.Join(',', table.Definition.Columns.Select(Csv))).Append("\r\n");
        foreach (var row in table.Rows)
            text.Append(string.Join(',', row.Select(cell => Csv(cell.Value)))).Append("\r\n");
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(text.ToString())];
    }

    public byte[] RenderXlsx(OccReportTable table)
    {
        Validate(table);
        using var stream = new MemoryStream();
        using (var document = SpreadsheetDocument.Create(stream, SpreadsheetDocumentType.Workbook, true))
        {
            var workbook = document.AddWorkbookPart();
            workbook.Workbook = new Workbook();
            var worksheet = workbook.AddNewPart<WorksheetPart>();
            var data = new SheetData();
            worksheet.Worksheet = new Worksheet(data);
            workbook.Workbook.AppendChild(new Sheets()).Append(new Sheet
            {
                Id = workbook.GetIdOfPart(worksheet), SheetId = 1U, Name = "Reporte",
            });
            foreach (var line in Heading(table)) Append(data, [new OccReportCell(line)]);
            Append(data, []);
            Append(data, table.Definition.Columns.Select(column => new OccReportCell(column)).ToArray());
            foreach (var row in table.Rows) Append(data, row);
            worksheet.Worksheet.Save();
            workbook.Workbook.Save();
        }
        return stream.ToArray();
    }

    public byte[] RenderPdf(OccReportTable table)
    {
        Validate(table);
        var columns = table.Definition.Columns;
        using var document = new PdfDocument();
        document.Info.Title = $"{table.Definition.Title} · {table.StationCode}";
        document.Info.Author = "ELEVANT";
        document.Info.Subject = "OCC · datos autorizados";
        var heading = new XFont(ElevantPdfFontResolver.Typeface, 15, XFontStyleEx.Regular);
        var body = new XFont(ElevantPdfFontResolver.Typeface, 8, XFontStyleEx.Regular);
        var muted = XColor.FromArgb(77, 93, 118);
        var navy = XColor.FromArgb(8, 27, 58);
        var rowIndex = 0;
        var rowLineOffset = 0;
        const double lineHeight = 12;
        do
        {
            var page = document.AddPage();
            page.Size = PageSize.A4;
            if (columns.Count >= 6) page.Orientation = PageOrientation.Landscape;
            using var graphics = XGraphics.FromPdfPage(page);
            var textWidth = page.Width.Point - 84;
            graphics.DrawRectangle(new XSolidBrush(navy), 0, 0, page.Width.Point, 88);
            graphics.DrawString("ELEVANT · CENTRO DE CONTROL OPERACIONAL", heading, XBrushes.White,
                new XRect(42, 26, textWidth, 28), XStringFormats.TopLeft);
            graphics.DrawString($"{table.Definition.Title} · {table.StationCode}", heading,
                new XSolidBrush(navy), new XRect(42, 107, textWidth, 28), XStringFormats.TopLeft);
            graphics.DrawString(string.Join("  ·  ", Heading(table).Skip(3)), body, new XSolidBrush(muted),
                new XRect(42, 139, textWidth, 18), XStringFormats.TopLeft);
            var y = 170d;
            var width = textWidth / columns.Count;
            var headers = columns.Select(column =>
                HumanResourcesReportPdfRenderer.WrapCellText(graphics, column, body, width)).ToArray();
            var headerLines = headers.Max(lines => lines.Count);
            for (var column = 0; column < columns.Count; column++)
                DrawLines(graphics, headers[column], body, navy, 42 + column * width, y, width, 0, headerLines, lineHeight);
            y += headerLines * lineHeight + 4;
            graphics.DrawLine(new XPen(navy, 0.6), 42, y, page.Width.Point - 42, y);
            y += 8;
            if (table.Rows.Count == 0)
                graphics.DrawString("Sin datos para el período seleccionado.", body, new XSolidBrush(muted),
                    new XRect(42, y, textWidth, lineHeight), XStringFormats.TopLeft);
            while (rowIndex < table.Rows.Count)
            {
                var availableLines = (int)Math.Floor((page.Height.Point - 50 - y - 6) / lineHeight);
                if (availableLines < 1) break;
                var row = table.Rows[rowIndex];
                var cells = row.Select(cell =>
                    HumanResourcesReportPdfRenderer.WrapCellText(graphics, cell.Value, body, width)).ToArray();
                var rowLines = cells.Max(lines => lines.Count);
                var drawnLines = Math.Min(rowLines - rowLineOffset, availableLines);
                for (var column = 0; column < row.Count; column++)
                    DrawLines(graphics, cells[column], body, navy, 42 + column * width, y, width, rowLineOffset,
                        drawnLines, lineHeight);
                y += drawnLines * lineHeight + 6;
                rowLineOffset += drawnLines;
                if (rowLineOffset < rowLines) break;
                graphics.DrawLine(new XPen(XColor.FromArgb(225, 231, 239), 0.3), 42, y - 2, page.Width.Point - 42, y - 2);
                rowLineOffset = 0;
                rowIndex++;
            }
            graphics.DrawString($"Página {document.PageCount}", body, new XSolidBrush(muted),
                new XRect(page.Width.Point - 110, page.Height.Point - 31, 68, 18), XStringFormats.TopRight);
        } while (rowIndex < table.Rows.Count);

        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    private static IEnumerable<string> Heading(OccReportTable table)
    {
        yield return "ELEVANT · Centro de Control Operacional";
        yield return table.Definition.Title;
        yield return $"Estación: {table.StationCode}";
        yield return $"Período: {Date(table.From)} – {Date(table.To)}";
        yield return $"Generado: {table.AsOf.ToUniversalTime().ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)} UTC";
        yield return $"Filas: {table.RowCount.ToString(CultureInfo.InvariantCulture)}";
    }

    private static string Date(DateOnly value) => value.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

    private static void Validate(OccReportTable table)
    {
        ArgumentNullException.ThrowIfNull(table);
        if (string.IsNullOrWhiteSpace(table.StationCode) || table.Definition.Columns.Count == 0 ||
            table.Rows.Any(row => row.Count != table.Definition.Columns.Count))
            throw new ArgumentException("The report table is incomplete.", nameof(table));
    }

    // RFC 4180 quoting; a leading formula character is neutralised so a cell never runs in Excel.
    internal static string Csv(string value)
    {
        var formula = value.Length > 0 && value[0] is '=' or '+' or '-' or '@' &&
            !decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out _);
        var safe = formula ? "'" + value : value;
        return safe.IndexOfAny([',', '"', '\r', '\n']) >= 0 ? $"\"{safe.Replace("\"", "\"\"")}\"" : safe;
    }

    private static void Append(SheetData data, IReadOnlyList<OccReportCell> values)
    {
        var row = new Row();
        foreach (var value in values)
            row.Append(value.Type == OccReportCellType.Number
                ? new Cell { DataType = CellValues.Number, CellValue = new CellValue(value.Value) }
                : new Cell
                {
                    DataType = CellValues.InlineString,
                    InlineString = new InlineString(new Text(value.Value) { Space = SpaceProcessingModeValues.Preserve }),
                });
        data.Append(row);
    }

    private static void DrawLines(XGraphics graphics, IReadOnlyList<string> lines, XFont font, XColor color,
        double x, double y, double width, int offset, int count, double lineHeight)
    {
        for (var line = 0; line < count && offset + line < lines.Count; line++)
            graphics.DrawString(lines[offset + line], font, new XSolidBrush(color),
                new XRect(x, y + line * lineHeight, width - 5, lineHeight), XStringFormats.TopLeft);
    }
}
