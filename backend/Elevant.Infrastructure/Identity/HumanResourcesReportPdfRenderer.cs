using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Infrastructure.Finance;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Identity;

public sealed class HumanResourcesReportPdfRenderer : IHumanResourcesReportPdfRenderer
{
    static HumanResourcesReportPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public byte[] Render(HumanResourcesReportSnapshot snapshot, string stationCode)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (string.IsNullOrWhiteSpace(stationCode) ||
            snapshot.Columns.Count == 0 ||
            snapshot.Rows.Any(row => row.Count != snapshot.Columns.Count))
            throw new ArgumentException("The report snapshot is incomplete.", nameof(snapshot));

        using var document = new PdfDocument();
        document.Info.Title = $"Reporte {snapshot.Kind} · {stationCode}";
        document.Info.Author = "ELEVANT";
        document.Info.Subject = "Gestión Humana · datos autorizados";
        var heading = ElevantPdfFonts.Regular(15);
        var body = ElevantPdfFonts.Regular(8);
        var muted = XColor.FromArgb(77, 93, 118);
        var navy = XColor.FromArgb(8, 27, 58);
        var rowIndex = 0;
        var rowLineOffset = 0;
        const double lineHeight = 12;
        do
        {
            var page = document.AddPage();
            page.Size = PageSize.A4;
            if (snapshot.Columns.Count >= 6) page.Orientation = PageOrientation.Landscape;
            using var graphics = XGraphics.FromPdfPage(page);
            graphics.DrawRectangle(new XSolidBrush(navy), 0, 0, page.Width.Point, 88);
            graphics.DrawString("ELEVANT · GESTIÓN HUMANA", heading, XBrushes.White,
                new XRect(42, 26, 510, 28), XStringFormats.TopLeft);
            graphics.DrawString($"{snapshot.Kind} · {stationCode}", heading,
                new XSolidBrush(navy), new XRect(42, 107, 510, 28), XStringFormats.TopLeft);
            graphics.DrawString($"Periodo {snapshot.From:yyyy-MM-dd} – {snapshot.To:yyyy-MM-dd}  ·  " +
                $"Generado {snapshot.AsOf.ToUniversalTime():yyyy-MM-dd HH:mm} UTC  ·  " +
                $"{snapshot.RowCount.ToString(CultureInfo.InvariantCulture)} filas",
                body, new XSolidBrush(muted), new XRect(42, 139, 510, 18),
                XStringFormats.TopLeft);
            if (snapshot.Kind == HumanResourcesReportKind.Expirations)
                graphics.DrawString(
                    $"Clase: {snapshot.DocumentKind ?? "Todas"}  ·  Vigencia: {snapshot.Validity ?? "Todas"}",
                    body, new XSolidBrush(muted), new XRect(42, 158, 510, 18),
                    XStringFormats.TopLeft);
            var y = 190d;
            var width = (page.Width.Point - 84) / snapshot.Columns.Count;
            var headers = snapshot.Columns.Select(column =>
                WrapCellText(graphics, column, body, width)).ToArray();
            var headerLines = headers.Max(lines => lines.Count);
            for (var column = 0; column < snapshot.Columns.Count; column++)
                DrawLines(graphics, headers[column], body, navy,
                    42 + column * width, y, width, 0, headerLines, lineHeight);
            y += headerLines * lineHeight + 12;
            while (rowIndex < snapshot.Rows.Count)
            {
                var availableLines = (int)Math.Floor(
                    (page.Height.Point - 50 - y - 6) / lineHeight);
                if (availableLines < 1) break;
                var row = snapshot.Rows[rowIndex];
                var cells = row.Select(cell =>
                    WrapCellText(graphics, cell.Value, body, width)).ToArray();
                var rowLines = cells.Max(lines => lines.Count);
                var drawnLines = Math.Min(rowLines - rowLineOffset, availableLines);
                for (var column = 0; column < row.Count; column++)
                    DrawLines(graphics, cells[column], body, navy,
                        42 + column * width, y, width, rowLineOffset,
                        drawnLines, lineHeight);
                y += drawnLines * lineHeight + 6;
                rowLineOffset += drawnLines;
                if (rowLineOffset < rowLines) break;
                graphics.DrawLine(new XPen(XColor.FromArgb(225, 231, 239), 0.3),
                    42, y - 2, page.Width.Point - 42, y - 2);
                rowLineOffset = 0;
                rowIndex++;
            }
            graphics.DrawString($"Página {document.PageCount}", body,
                new XSolidBrush(muted),
                new XRect(page.Width.Point - 110, page.Height.Point - 31, 68, 18),
                XStringFormats.TopRight);
        } while (rowIndex < snapshot.Rows.Count);

        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    internal static IReadOnlyList<string> WrapCellText(XGraphics graphics,
        string? value, XFont font, double width)
    {
        var safeValue = value ?? string.Empty;
        var text = new string(safeValue.Select(character =>
            char.IsControl(character) ? ' ' : character).ToArray());
        if (text.Length == 0) return [string.Empty];
        var lines = new List<string>();
        for (var offset = 0; offset < text.Length;)
        {
            var length = 1;
            while (offset + length <= text.Length &&
                graphics.MeasureString(text.Substring(offset, length), font).Width <= width - 7)
                length++;
            var count = Math.Max(1, length - 1);
            lines.Add(text.Substring(offset, count));
            offset += count;
        }
        return lines;
    }

    private static void DrawLines(XGraphics graphics, IReadOnlyList<string> lines,
        XFont font, XColor color, double x, double y, double width,
        int offset, int count, double lineHeight)
    {
        for (var line = 0; line < count && offset + line < lines.Count; line++)
            graphics.DrawString(lines[offset + line], font, new XSolidBrush(color),
                new XRect(x, y + line * lineHeight, width - 5, lineHeight),
                XStringFormats.TopLeft);
    }
}
