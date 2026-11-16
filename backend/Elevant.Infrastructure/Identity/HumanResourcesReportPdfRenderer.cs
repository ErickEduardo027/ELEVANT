using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Infrastructure.Finance;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Identity;

/// <summary>
/// The PDF of a Gestión Humana report (3-N16): the report's Spanish title, its period and filters in Spanish, when it
/// was generated in the station's local time and, without rows, an explicit empty state. The cells arrive translated
/// from the store.
/// </summary>
public sealed class HumanResourcesReportPdfRenderer : IHumanResourcesReportPdfRenderer
{
    /// <summary>What an export without rows says, as the report screen does.</summary>
    internal const string EmptyState = "No hay filas para estos filtros.";

    static HumanResourcesReportPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public byte[] Render(HumanResourcesReportSnapshot snapshot, string stationCode)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (string.IsNullOrWhiteSpace(stationCode) ||
            snapshot.Columns.Count == 0 ||
            snapshot.Rows.Any(row => row.Count != snapshot.Columns.Count))
            throw new ArgumentException("The report snapshot is incomplete.", nameof(snapshot));

        using var document = new PdfDocument();
        document.Info.Title = $"{HumanResourcesReportLabels.Title(snapshot.Kind)} · {stationCode}";
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
            graphics.DrawString($"{HumanResourcesReportLabels.Title(snapshot.Kind)} · {stationCode}", heading,
                new XSolidBrush(navy), new XRect(42, 107, 510, 28), XStringFormats.TopLeft);
            graphics.DrawString($"Período {Period(snapshot)}  ·  Generado {Generated(snapshot)}  ·  {RowCount(snapshot)}",
                body, new XSolidBrush(muted), new XRect(42, 139, 510, 18),
                XStringFormats.TopLeft);
            if (snapshot.Kind == HumanResourcesReportKind.Expirations)
                graphics.DrawString(Filters(snapshot),
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
            if (snapshot.Rows.Count == 0)
                graphics.DrawString(EmptyState, body, new XSolidBrush(muted),
                    new XRect(42, y, page.Width.Point - 84, lineHeight), XStringFormats.TopLeft);
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

    /// <summary>The period of the filter, «02/12/2099 – 31/12/2099».</summary>
    internal static string Period(HumanResourcesReportSnapshot snapshot) =>
        $"{Date(snapshot.From)} – {Date(snapshot.To)}";

    /// <summary>When the snapshot was read, «05/10/2026 08:00 (hora local)»: the station's zone, else AVIAM's calendar.</summary>
    internal static string Generated(HumanResourcesReportSnapshot snapshot)
    {
        var local = TimeZoneInfo.ConvertTime(snapshot.AsOf, BusinessCalendar.Zone(snapshot.TimeZone));
        return $"{local.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture)} (hora local)";
    }

    /// <summary>«Clase: Habilitaciones · Vigencia: Vigentes»: the filters of the expirations report in Spanish.</summary>
    internal static string Filters(HumanResourcesReportSnapshot snapshot) =>
        $"Clase: {HumanResourcesReportLabels.DocumentKindFilter(snapshot.DocumentKind)} · " +
        $"Vigencia: {HumanResourcesReportLabels.Validity(snapshot.Validity)}";

    private static string RowCount(HumanResourcesReportSnapshot snapshot) => snapshot.RowCount == 1
        ? "1 fila" : $"{snapshot.RowCount.ToString(CultureInfo.InvariantCulture)} filas";

    private static string Date(DateOnly value) => value.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture);

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
