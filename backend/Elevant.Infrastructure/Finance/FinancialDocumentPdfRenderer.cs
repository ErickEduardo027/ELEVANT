using System.Globalization;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;
using Elevant.Application.Finance;
using Elevant.Application.Abstractions.Finance;

namespace Elevant.Infrastructure.Finance;

/// <summary>Renders immutable, explicitly non-fiscal financial snapshots.</summary>
public sealed class FinancialDocumentPdfRenderer : IFinancialDocumentPdfRenderer
{
    private const double Margin = 46;
    private const double RowHeight = 23;
    private const string Typeface = "Elevant Noto Sans";
    private static readonly XColor Navy = XColor.FromArgb(8, 27, 58);
    private static readonly XColor Blue = XColor.FromArgb(18, 84, 190);
    private static readonly XColor Muted = XColor.FromArgb(87, 102, 122);

    static FinancialDocumentPdfRenderer()
    {
        if (GlobalFontSettings.FontResolver is not null)
            throw new InvalidOperationException("The financial PDF font resolver must be configured before other PDF fonts.");
        GlobalFontSettings.FontResolver = new BundledFontResolver();
    }

    public byte[] RenderInvoice(NonFiscalInvoiceData invoice)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        if (string.IsNullOrWhiteSpace(invoice.Number) || invoice.Lines is null ||
            invoice.Lines.Count == 0 || invoice.CurrencyCode.Length != 3)
            throw new ArgumentException("The invoice snapshot is incomplete.", nameof(invoice));

        using var document = new PdfDocument();
        document.Info.Title = $"Factura no fiscal {invoice.Number}";
        document.Info.Subject = "NonFiscal Development invoice; not a tax document";
        document.Info.Author = "ELEVANT";
        var body = new XFont(Typeface, 9, XFontStyleEx.Regular);
        var caption = new XFont(Typeface, 8, XFontStyleEx.Regular);
        var heading = new XFont(Typeface, 16, XFontStyleEx.Regular);

        var lineIndex = 0;
        while (lineIndex < invoice.Lines.Count)
        {
            var page = document.AddPage();
            page.Size = PageSize.A4;
            using var graphics = XGraphics.FromPdfPage(page);
            DrawFrame(graphics, page, heading, caption, "Factura de prueba",
                invoice.Number, invoice.IssuedAt, document.PageCount);
            var y = 183d;
            DrawText(graphics, "OPERACIÓN", body, Muted, Margin, y, 128);
            DrawText(graphics, "SERVICIO", body, Muted, 178, y, 190);
            DrawText(graphics, "CANT.", body, Muted, 405, y, 50);
            DrawText(graphics, "IMPORTE", body, Muted, 472, y, 80);
            graphics.DrawLine(new XPen(Muted, 0.4), Margin, y + 18,
                page.Width.Point - Margin, y + 18);
            y += 28;
            while (lineIndex < invoice.Lines.Count && y + RowHeight < page.Height.Point - 111)
            {
                var line = invoice.Lines[lineIndex++];
                DrawText(graphics, line.OperationCode, body, Navy, Margin, y, 125);
                DrawText(graphics, $"{line.ServiceCode} · {line.ServiceName}", body,
                    Navy, 178, y, 214);
                DrawText(graphics, Money(line.ExecutedQuantity), body, Navy, 405, y, 62);
                DrawText(graphics, Money(line.Amount), body, Navy, 472, y, 77);
                graphics.DrawLine(new XPen(XColor.FromArgb(225, 231, 239), 0.3),
                    Margin, y + 18, page.Width.Point - Margin, y + 18);
                y += RowHeight;
            }
            if (lineIndex == invoice.Lines.Count)
            {
                DrawText(graphics, "TOTAL CONGELADO", body, Blue,
                    355, page.Height.Point - 102, 125);
                DrawText(graphics, $"{invoice.CurrencyCode} {Money(invoice.Total)}", body,
                    Navy, 453, page.Height.Point - 102, 100);
            }
        }

        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    public byte[] RenderReceipt(NonFiscalPaymentData payment, string invoiceNumber)
    {
        ArgumentNullException.ThrowIfNull(payment);
        if (string.IsNullOrWhiteSpace(invoiceNumber) ||
            string.IsNullOrWhiteSpace(payment.Reference) || payment.CurrencyCode.Length != 3 ||
            payment.Amount <= 0)
            throw new ArgumentException("The payment snapshot is incomplete.", nameof(payment));

        using var document = new PdfDocument();
        document.Info.Title = $"Recibo no fiscal {payment.Reference}";
        document.Info.Subject = "NonFiscal Development payment receipt; not an external settlement";
        document.Info.Author = "ELEVANT";
        var body = new XFont(Typeface, 11, XFontStyleEx.Regular);
        var caption = new XFont(Typeface, 8, XFontStyleEx.Regular);
        var heading = new XFont(Typeface, 16, XFontStyleEx.Regular);
        var page = document.AddPage();
        page.Size = PageSize.A4;
        using (var graphics = XGraphics.FromPdfPage(page))
        {
            DrawFrame(graphics, page, heading, caption, "Recibo de pago de prueba",
                payment.Reference, payment.RecordedAt, 1);
            DrawText(graphics, "Factura vinculada", caption, Muted, Margin, 194, 190);
            DrawText(graphics, invoiceNumber, body, Navy, Margin, 215, 480);
            DrawText(graphics, "Referencia de pago", caption, Muted, Margin, 266, 190);
            DrawText(graphics, payment.Reference, body, Navy, Margin, 287, 480);
            DrawText(graphics, "Importe registrado", caption, Muted, Margin, 338, 190);
            DrawText(graphics, $"{payment.CurrencyCode} {Money(payment.Amount)}",
                heading, Blue, Margin, 363, 480);
            DrawText(graphics, "Registro manual de prueba; no acredita una liquidación externa.",
                caption, Muted, Margin, 420, 500);
        }
        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    private static void DrawFrame(XGraphics graphics, PdfPage page, XFont heading,
        XFont caption, string title, string reference, DateTimeOffset timestamp, int pageNumber)
    {
        graphics.DrawRectangle(new XSolidBrush(Navy), 0, 0, page.Width.Point, 109);
        DrawText(graphics, "ELEVANT", heading, XColors.White, Margin, 30, 220);
        DrawText(graphics, "DOCUMENTO NO FISCAL · DESARROLLO", caption,
            XColors.White, Margin, 68, 360);
        DrawText(graphics, title, heading, Navy, Margin, 130, 350);
        DrawText(graphics, reference, caption, Muted, 383, 136, 166);
        DrawText(graphics, timestamp.ToUniversalTime().ToString("yyyy-MM-dd HH:mm 'UTC'",
            CultureInfo.InvariantCulture), caption, Muted, 383, 155, 166);
        graphics.DrawLine(new XPen(Muted, 0.4), Margin, page.Height.Point - 51,
            page.Width.Point - Margin, page.Height.Point - 51);
        DrawText(graphics, "Sin NCF, impuestos ni validez fiscal.", caption, Muted,
            Margin, page.Height.Point - 41, 350);
        DrawText(graphics, $"Pág. {pageNumber}", caption, Muted,
            page.Width.Point - Margin - 47, page.Height.Point - 41, 47);
    }

    private static void DrawText(XGraphics graphics, string value, XFont font,
        XColor color, double x, double y, double width)
    {
        var text = new string((value ?? string.Empty).Select(character =>
            char.IsControl(character) ? ' ' : character).ToArray());
        if (graphics.MeasureString(text, font).Width > width)
        {
            while (text.Length > 0 && graphics.MeasureString(text + "...", font).Width > width)
                text = text[..^1];
            text += "...";
        }
        graphics.DrawString(text, font, new XSolidBrush(color),
            new XRect(x, y, width, 20), XStringFormats.TopLeft);
    }

    private static string Money(decimal amount) =>
        amount.ToString("N2", CultureInfo.InvariantCulture);

    private sealed class BundledFontResolver : IFontResolver
    {
        private const string FaceName = "elevant-noto-sans-regular";
        private static readonly Lazy<byte[]> FontBytes = new(() =>
        {
            var assembly = typeof(FinancialDocumentPdfRenderer).Assembly;
            var resource = assembly.GetManifestResourceNames().Single(name =>
                name.EndsWith("NotoSans-Regular.ttf", StringComparison.Ordinal));
            using var stream = assembly.GetManifestResourceStream(resource)!;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            return buffer.ToArray();
        });

        public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
            familyName == Typeface ? new FontResolverInfo(FaceName) : null;

        public byte[]? GetFont(string faceName) =>
            faceName == FaceName ? FontBytes.Value : null;
    }
}
