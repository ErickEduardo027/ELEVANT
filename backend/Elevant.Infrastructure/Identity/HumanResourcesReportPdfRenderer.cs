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
        var heading = new XFont(ElevantPdfFontResolver.Typeface, 15, XFontStyleEx.Regular);
        var body = new XFont(ElevantPdfFontResolver.Typeface, 8, XFontStyleEx.Regular);
        var muted = XColor.FromArgb(77, 93, 118);
        var navy = XColor.FromArgb(8, 27, 58);
        var rowIndex = 0;
        do
        {
            var page = document.AddPage();
            page.Size = PageSize.A4;
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
            var y = 181d;
            var width = (page.Width.Point - 84) / snapshot.Columns.Count;
            for (var column = 0; column < snapshot.Columns.Count; column++)
                DrawCell(graphics, snapshot.Columns[column], body, navy,
                    42 + column * width, y, width);
            y += 24;
            while (rowIndex < snapshot.Rows.Count && y + 20 < page.Height.Point - 50)
            {
                var row = snapshot.Rows[rowIndex++];
                for (var column = 0; column < row.Count; column++)
                    DrawCell(graphics, row[column].Value, body, navy,
                        42 + column * width, y, width);
                graphics.DrawLine(new XPen(XColor.FromArgb(225, 231, 239), 0.3),
                    42, y + 17, page.Width.Point - 42, y + 17);
                y += 21;
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

    private static void DrawCell(XGraphics graphics, string value, XFont font,
        XColor color, double x, double y, double width)
    {
        var safeValue = value ?? string.Empty;
        var text = new string(safeValue.Select(character =>
            char.IsControl(character) ? ' ' : character).ToArray());
        while (text.Length > 0 && graphics.MeasureString(text + "…", font).Width > width - 7)
            text = text[..^1];
        if (text.Length < safeValue.Length) text += "…";
        graphics.DrawString(text, font, new XSolidBrush(color),
            new XRect(x, y, width - 5, 18), XStringFormats.TopLeft);
    }
}
