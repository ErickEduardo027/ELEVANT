using System.Globalization;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using Elevant.Application.Finance;
using Elevant.Application.Abstractions.Finance;

namespace Elevant.Infrastructure.Finance;

/// <summary>Renders immutable, explicitly non-fiscal financial snapshots.</summary>
public sealed class FinancialDocumentPdfRenderer : IFinancialDocumentPdfRenderer
{
    private const double Margin = 46;
    private const double RowHeight = 23;
    private const string Typeface = ElevantPdfFontResolver.Typeface;
    private static readonly XColor Navy = XColor.FromArgb(8, 27, 58);
    private static readonly XColor Blue = XColor.FromArgb(18, 84, 190);
    private static readonly XColor Muted = XColor.FromArgb(87, 102, 122);

    static FinancialDocumentPdfRenderer()
    {
        ElevantPdfFontResolver.EnsureRegistered();
    }

    public byte[] RenderInvoice(NonFiscalInvoiceData invoice)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        if (string.IsNullOrWhiteSpace(invoice.Number) || invoice.Lines is null ||
            invoice.Lines.Count == 0 || invoice.CurrencyCode.Length != 3)
            throw new ArgumentException("The invoice snapshot is incomplete.", nameof(invoice));
        if (invoice.Fiscal is { FiscalNumber: not null, SecurityCode: not null } fiscal)
            return RenderFiscalInvoice(invoice, fiscal);

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

    /// <summary>
    /// ADR-0035: simulated e-CF type 31 (crédito fiscal). Parties, e-NCF, security code, due date,
    /// subtotal/ITBIS/total and a simulated QR, always with the «sin validez fiscal» legend.
    /// </summary>
    private static byte[] RenderFiscalInvoice(NonFiscalInvoiceData invoice, NonFiscalInvoiceFiscalData fiscal)
    {
        using var document = new PdfDocument();
        document.Info.Title = $"Factura de crédito fiscal {fiscal.FiscalNumber} ({invoice.Number})";
        document.Info.Subject = FinanceInvoicePolicy.Disclaimer;
        document.Info.Author = "ELEVANT";
        var body = new XFont(Typeface, 9, XFontStyleEx.Regular);
        var caption = new XFont(Typeface, 8, XFontStyleEx.Regular);
        var heading = new XFont(Typeface, 16, XFontStyleEx.Regular);
        var net = fiscal.NetTotal ?? invoice.Lines.Sum(line => line.NetAmount ?? line.Amount);
        var tax = fiscal.TaxTotal ?? invoice.Lines.Sum(line => line.TaxAmount ?? 0m);
        var lineIndex = 0;
        while (lineIndex < invoice.Lines.Count)
        {
            var page = document.AddPage();
            page.Size = PageSize.A4;
            using var graphics = XGraphics.FromPdfPage(page);
            var width = page.Width.Point;
            graphics.DrawRectangle(new XSolidBrush(Navy), 0, 0, width, 96);
            DrawText(graphics, fiscal.IssuerName, heading, XColors.White, Margin, 24, 300);
            DrawText(graphics, $"RNC {fiscal.IssuerRnc} · Estación {fiscal.StationCode}", caption,
                XColors.White, Margin, 52, 300);
            DrawText(graphics, FinanceInvoicePolicy.Disclaimer.ToUpperInvariant(), caption, XColors.White,
                Margin, 68, 300);
            DrawText(graphics, "FACTURA DE CRÉDITO FISCAL ELECTRÓNICA", caption, XColors.White, 340, 24, 210);
            DrawText(graphics, $"e-NCF {fiscal.FiscalNumber}", heading, XColors.White, 340, 40, 210);
            DrawText(graphics, $"Interno {invoice.Number}", caption, XColors.White, 340, 68, 210);

            DrawText(graphics, "CLIENTE", caption, Muted, Margin, 112, 200);
            DrawText(graphics, fiscal.CustomerName, body, Navy, Margin, 126, 280);
            DrawText(graphics, "EMISIÓN", caption, Muted, 340, 112, 100);
            DrawText(graphics, Date(fiscal.SignedAt ?? invoice.IssuedAt), body, Navy, 340, 126, 100);
            DrawText(graphics, "VENCIMIENTO", caption, Muted, 450, 112, 100);
            DrawText(graphics, fiscal.DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "—",
                body, Navy, 450, 126, 100);

            var y = 160d;
            DrawText(graphics, "OPERACIÓN", caption, Muted, Margin, y, 110);
            DrawText(graphics, "SERVICIO / CARGO", caption, Muted, 158, y, 170);
            DrawText(graphics, "CANT.", caption, Muted, 332, y, 44);
            DrawText(graphics, "NETO", caption, Muted, 380, y, 60);
            DrawText(graphics, "ITBIS", caption, Muted, 444, y, 50);
            DrawText(graphics, "TOTAL", caption, Muted, 498, y, 60);
            graphics.DrawLine(new XPen(Muted, 0.4), Margin, y + 16, width - Margin, y + 16);
            y += 24;
            while (lineIndex < invoice.Lines.Count && y + RowHeight < page.Height.Point - 200)
            {
                var line = invoice.Lines[lineIndex++];
                DrawText(graphics, line.OperationCode, body, Navy, Margin, y, 108);
                DrawText(graphics, $"{line.ServiceCode} · {line.ServiceName}", body, Navy, 158, y, 170);
                DrawText(graphics, Money(line.ExecutedQuantity), body, Navy, 332, y, 44);
                DrawText(graphics, Money(line.NetAmount ?? line.Amount), body, Navy, 380, y, 60);
                DrawText(graphics, Money(line.TaxAmount ?? 0m), body, Navy, 444, y, 50);
                DrawText(graphics, Money(line.Amount), body, Navy, 498, y, 60);
                graphics.DrawLine(new XPen(XColor.FromArgb(225, 231, 239), 0.3), Margin, y + 18, width - Margin, y + 18);
                y += RowHeight;
            }
            if (lineIndex == invoice.Lines.Count)
            {
                var bottom = page.Height.Point - 180;
                DrawSimulatedQr(graphics, $"{fiscal.FiscalNumber}|{fiscal.SecurityCode}|{invoice.Total}", Margin, bottom, 84);
                DrawText(graphics, $"Código de seguridad {fiscal.SecurityCode}", body, Navy, Margin + 96, bottom, 220);
                DrawText(graphics, $"Firma {Date(fiscal.SignedAt ?? invoice.IssuedAt)}", caption, Muted, Margin + 96, bottom + 16, 220);
                DrawText(graphics, "QR de consulta simulado: no se valida ante la DGII.", caption, Muted,
                    Margin + 96, bottom + 32, 220);
                DrawText(graphics, "SUBTOTAL", caption, Muted, 380, bottom, 80);
                DrawText(graphics, $"{invoice.CurrencyCode} {Money(net)}", body, Navy, 460, bottom, 98);
                DrawText(graphics, $"ITBIS {FinanceInvoicePolicy.ItbisRate:0}%", caption, Muted, 380, bottom + 18, 80);
                DrawText(graphics, $"{invoice.CurrencyCode} {Money(tax)}", body, Navy, 460, bottom + 18, 98);
                graphics.DrawLine(new XPen(Muted, 0.4), 380, bottom + 36, width - Margin, bottom + 36);
                DrawText(graphics, "TOTAL", caption, Blue, 380, bottom + 42, 80);
                DrawText(graphics, $"{invoice.CurrencyCode} {Money(invoice.Total)}", body, Blue, 460, bottom + 42, 98);
            }
            graphics.DrawLine(new XPen(Muted, 0.4), Margin, page.Height.Point - 51, width - Margin, page.Height.Point - 51);
            DrawText(graphics, $"{FinanceInvoicePolicy.Disclaimer}. Documento de demostración de ELEVANT.", caption, Muted,
                Margin, page.Height.Point - 41, 380);
            DrawText(graphics, $"Pág. {document.PageCount}", caption, Muted, width - Margin - 47, page.Height.Point - 41, 47);
        }
        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    /// <summary>A deterministic QR-like 21×21 pattern; it encodes nothing a reader could validate.</summary>
    private static void DrawSimulatedQr(XGraphics graphics, string seed, double x, double y, double size)
    {
        const int cells = 21;
        var cell = size / cells;
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed));
        var brush = new XSolidBrush(Navy);
        static bool Finder(int r, int c, int top, int left)
        {
            var dr = r - top;
            var dc = c - left;
            if (dr is < 0 or > 6 || dc is < 0 or > 6) return false;
            return dr is 0 or 6 || dc is 0 or 6 || (dr is >= 2 and <= 4 && dc is >= 2 and <= 4);
        }
        for (var row = 0; row < cells; row++)
        for (var column = 0; column < cells; column++)
        {
            var inFinder = (row < 7 && column < 7) || (row < 7 && column > 13) || (row > 13 && column < 7);
            var bit = row * cells + column;
            var dark = inFinder
                ? Finder(row, column, 0, 0) || Finder(row, column, 0, 14) || Finder(row, column, 14, 0)
                : ((hash[bit / 8 % hash.Length] >> (bit % 8)) & 1) == 1;
            if (dark) graphics.DrawRectangle(brush, x + column * cell, y + row * cell, cell, cell);
        }
    }

    private static string Date(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

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

    public byte[] RenderCardReceipt(CardPaymentReceiptData receipt)
    {
        ArgumentNullException.ThrowIfNull(receipt);
        using var document = new PdfDocument();
        document.Info.Title = $"Recibo de pago {receipt.AuthorizationCode} · factura {receipt.FiscalNumber ?? receipt.InvoiceNumber}";
        document.Info.Subject = FinanceInvoicePolicy.Disclaimer;
        document.Info.Author = "ELEVANT";
        var body = new XFont(Typeface, 11, XFontStyleEx.Regular);
        var caption = new XFont(Typeface, 8, XFontStyleEx.Regular);
        var heading = new XFont(Typeface, 16, XFontStyleEx.Regular);
        var page = document.AddPage();
        page.Size = PageSize.A4;
        using (var graphics = XGraphics.FromPdfPage(page))
        {
            DrawFrame(graphics, page, heading, caption, "Recibo de pago con tarjeta", receipt.ReceiptReference, receipt.PaidAt, 1);
            var rows = new (string Label, string Value)[]
            {
                ("Aerolínea", receipt.AirlineName),
                ("Factura", receipt.FiscalNumber is null ? receipt.InvoiceNumber : $"e-NCF {receipt.FiscalNumber} · {receipt.InvoiceNumber}"),
                ("Tarjeta", $"{receipt.Brand} terminada en {receipt.Last4}"),
                ("Autorización", receipt.AuthorizationCode),
            };
            var y = 194d;
            foreach (var (label, value) in rows)
            {
                DrawText(graphics, label, caption, Muted, Margin, y, 190);
                DrawText(graphics, value, body, Navy, Margin, y + 21, 480);
                y += 58;
            }
            DrawText(graphics, "Importe pagado", caption, Muted, Margin, y, 190);
            DrawText(graphics, $"{receipt.CurrencyCode} {Money(receipt.Amount)}", heading, Blue, Margin, y + 25, 480);
            DrawText(graphics, "Pago simulado: no se movió dinero real. Simulación — sin validez fiscal.", caption, Muted,
                Margin, y + 80, 500);
        }
        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    public byte[] RenderReport(FinanceReportData report, string filterSummary)
    {
        ArgumentNullException.ThrowIfNull(report);
        using var document = new PdfDocument();
        document.Info.Title = report.Title;
        document.Info.Subject = "Non-fiscal finance report";
        document.Info.Author = "ELEVANT";
        var body = new XFont(Typeface, 8, XFontStyleEx.Regular);
        var caption = new XFont(Typeface, 8, XFontStyleEx.Regular);
        var heading = new XFont(Typeface, 16, XFontStyleEx.Regular);
        var generatedAt = DateTimeOffset.UtcNow;
        var columns = report.Columns.Count == 0 ? 1 : report.Columns.Count;
        var rowIndex = 0;
        var first = true;
        while (first || rowIndex < report.Rows.Count)
        {
            var page = document.AddPage();
            page.Size = PageSize.A4;
            page.Orientation = PageOrientation.Landscape;
            using var graphics = XGraphics.FromPdfPage(page);
            DrawFrame(graphics, page, heading, caption, report.Title,
                $"{report.From:yyyy-MM-dd} – {report.To:yyyy-MM-dd}", generatedAt, document.PageCount);
            var y = 160d;
            if (first)
            {
                DrawText(graphics, filterSummary, caption, Muted, Margin, y, page.Width.Point - 2 * Margin);
                y += 16;
                var metrics = string.Join("   ·   ", report.Summary.Select(metric =>
                    $"{metric.Label}: {metric.Value}{(metric.CurrencyCode is null ? string.Empty : " " + metric.CurrencyCode)}"));
                if (metrics.Length > 0)
                {
                    DrawText(graphics, metrics, body, Blue, Margin, y, page.Width.Point - 2 * Margin);
                    y += 18;
                }
                first = false;
            }
            var width = (page.Width.Point - 2 * Margin) / columns;
            for (var column = 0; column < report.Columns.Count; column++)
                DrawText(graphics, report.Columns[column].Label.ToUpperInvariant(), caption, Muted,
                    Margin + column * width, y, width - 4);
            graphics.DrawLine(new XPen(Muted, 0.4), Margin, y + 14, page.Width.Point - Margin, y + 14);
            y += 20;
            while (rowIndex < report.Rows.Count && y + 16 < page.Height.Point - 60)
            {
                var row = report.Rows[rowIndex++];
                for (var column = 0; column < row.Count && column < report.Columns.Count; column++)
                    DrawText(graphics, row[column] ?? "—", body, Navy, Margin + column * width, y, width - 4);
                y += 16;
            }
            if (report.Rows.Count == 0)
                DrawText(graphics, "Sin datos para los filtros elegidos.", body, Muted, Margin, y, 300);
            foreach (var note in rowIndex >= report.Rows.Count ? report.Notes : [])
            {
                y += 14;
                if (y < page.Height.Point - 60) DrawText(graphics, note, caption, Muted, Margin, y, page.Width.Point - 2 * Margin);
            }
        }
        using var stream = new MemoryStream();
        document.Save(stream, false);
        return stream.ToArray();
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
        amount.ToString("#,##0.00##", CultureInfo.InvariantCulture);

}
