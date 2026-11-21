using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Validation;
using Elevant.Infrastructure.Documents;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Finance;

/// <summary>
/// The financial documents of ELEVANT on the common document writer (PR E): the simulated e-CF type 31 invoice
/// (ADR-0035), the legacy non-fiscal invoice, the credit and debit notes (4-N17), the receipts of a recorded payment, of
/// a card payment (ADR-0036) and of a treasury collection, and the statement of account. Every page carries the logo,
/// the document's identity, «Página X de Y» and, where the document is a simulation, «Simulación — sin validez fiscal».
/// Figures are right-aligned with thousands and the same decimals per column; dates are dd/MM/yyyy in Santo Domingo; the
/// smallest letter is 9 pt so the printout reads. Documents already stored (SHA-256) are never regenerated: the design
/// applies to new ones.
/// </summary>
public sealed class FinancialDocumentPdfRenderer : IFinancialDocumentPdfRenderer, IStatementDocumentRenderer
{
    /// <summary>The fiscal title the invoice prints, as large as its e-NCF (G2).</summary>
    public const string FiscalInvoiceTitle = "FACTURA DE CRÉDITO FISCAL ELECTRÓNICA";

    /// <summary>The line of the totals block for charges that are neither the subtotal nor the ITBIS (G2).</summary>
    public const string OtherChargesLabel = "Otros cargos";

    private const string SimulationNotice = FinanceInvoicePolicy.Disclaimer +
        ": comprobante simulado por ELEVANT; no se envía ni se valida ante la DGII.";

    static FinancialDocumentPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public byte[] RenderInvoice(NonFiscalInvoiceData invoice)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        if (string.IsNullOrWhiteSpace(invoice.Number) || invoice.Lines is null ||
            invoice.Lines.Count == 0 || invoice.CurrencyCode.Length != 3)
            throw new ArgumentException("The invoice snapshot is incomplete.", nameof(invoice));
        return invoice.Fiscal is { FiscalNumber: not null, SecurityCode: not null } fiscal
            ? RenderFiscalInvoice(invoice, fiscal)
            : RenderNonFiscalInvoice(invoice);
    }

    /// <summary>The invoice issued before ADR-0035: no NCF and no tax, its lines and its total.</summary>
    private static byte[] RenderNonFiscalInvoice(NonFiscalInvoiceData invoice)
    {
        using var document = new PdfDocument();
        document.Info.Title = $"Factura no fiscal {invoice.Number}";
        document.Info.Subject = "NonFiscal Development invoice; not a tax document";
        document.Info.Author = "ELEVANT";
        var writer = new DocumentPdfWriter(document,
            new DocumentLetterhead("FACTURA NO FISCAL", invoice.Number,
                ["AVIAM Ltd. · Servicios de asistencia en tierra"], $"Factura no fiscal {invoice.Number}"),
            new DocumentFooter("Documento no fiscal: sin NCF, impuestos ni validez fiscal. ELEVANT · AVIAM."));
        writer.Facts([
            ("Emisión", Date(invoice.IssuedAt)), ("Moneda", invoice.CurrencyCode),
            ("Líneas", DocumentText.Count(invoice.Lines.Count, "línea", "líneas")), ("Total", Money(invoice.Total, invoice.CurrencyCode)),
        ]);
        var decimals = DocumentText.Decimals(invoice.Lines.Select(line => line.Amount).Append(invoice.Total));
        writer.Table(
            [new("Fecha del servicio", Weight: 0.8), new("Descripción", Weight: 2.6), new("Cant.", true),
                new("Precio unit.", true), new($"Importe ({invoice.CurrencyCode})", true)],
            invoice.Lines.Select(line => new[]
            {
                DocumentText.Date(line.OperationDate),
                $"{line.ServiceName} ({line.ServiceCode}) · operación {line.OperationCode} · por {DocumentText.Unit(line.BillingUnit)}",
                DocumentText.Quantity(line.ExecutedQuantity), DocumentText.Amount(line.UnitPrice, DocumentText.Decimals(line.UnitPrice)),
                DocumentText.Amount(line.Amount, decimals),
            }).ToArray(), "Sin líneas.");
        writer.Totals([new($"Total {invoice.CurrencyCode}", DocumentText.Amount(invoice.Total, decimals), true)], 230);
        writer.Finish();
        return Save(document);
    }

    /// <summary>
    /// ADR-0035 and G2: the simulated e-CF type 31 (crédito fiscal). The title is as large as the e-NCF; issuer and buyer
    /// with their RNC; issue date apart from each line's service date; the payment condition (credit with its due date,
    /// or cash); the lines with their figures right-aligned; and Subtotal, Otros cargos, ITBIS and Total in one block,
    /// next to the security code and the simulated QR.
    /// </summary>
    private static byte[] RenderFiscalInvoice(NonFiscalInvoiceData invoice, NonFiscalInvoiceFiscalData fiscal)
    {
        using var document = new PdfDocument();
        document.Info.Title = $"Factura de crédito fiscal {fiscal.FiscalNumber} ({invoice.Number})";
        document.Info.Subject = FinanceInvoicePolicy.Disclaimer;
        document.Info.Author = "ELEVANT";
        var net = fiscal.NetTotal ?? invoice.Lines.Sum(line => line.NetAmount ?? line.Amount);
        var tax = fiscal.TaxTotal ?? invoice.Lines.Sum(line => line.TaxAmount ?? 0m);
        var other = invoice.Total - net - tax;
        var issuedOn = BusinessCalendar.Today(fiscal.SignedAt ?? invoice.IssuedAt);
        var writer = new DocumentPdfWriter(document,
            new DocumentLetterhead(FiscalInvoiceTitle, $"e-NCF {fiscal.FiscalNumber}",
                [$"Tipo de e-CF 31 · Número interno {invoice.Number}"],
                $"Factura de crédito fiscal electrónica · e-NCF {fiscal.FiscalNumber}"),
            new DocumentFooter($"{FinanceInvoicePolicy.Disclaimer}. {fiscal.IssuerName} · RNC {fiscal.IssuerRnc} · e-NCF {fiscal.FiscalNumber}.")
            {
                LegendColor = DocumentPalette.Orange,
            });
        writer.Notice(SimulationNotice);
        writer.Boxes([
            new("Emisor", [fiscal.IssuerName, $"RNC {fiscal.IssuerRnc}", $"Estación {fiscal.StationCode}"]),
            new("Comprador", [fiscal.CustomerName, BuyerTaxRegistration(fiscal) ?? "Identificación fiscal no registrada"], Accent: true),
        ]);
        writer.Facts([
            ("Emisión", DocumentText.Date(issuedOn)),
            ("Vencimiento", fiscal.DueDate is { } due ? DocumentText.Date(due) : "—"),
            ("Condición de pago", PaymentCondition(issuedOn, fiscal.DueDate)),
            ("Moneda", invoice.CurrencyCode),
        ]);
        var amounts = DocumentText.Decimals(invoice.Lines.SelectMany(line => new[]
            { line.NetAmount ?? line.Amount, line.TaxAmount ?? 0m, line.Amount }).Concat([net, tax, other, invoice.Total]));
        writer.Table(
            [new("Fecha del servicio", Weight: 0.9), new("Descripción", Weight: 2.6), new("Cant.", true), new("Precio unit.", true),
                new("Neto", true), new("ITBIS", true), new($"Total ({invoice.CurrencyCode})", true)],
            invoice.Lines.Select(line => new[]
            {
                DocumentText.Date(line.OperationDate),
                $"{line.ServiceName} ({line.ServiceCode}) · operación {line.OperationCode} · por " +
                    DocumentText.Unit(line.BillingUnit),
                DocumentText.Quantity(line.ExecutedQuantity),
                DocumentText.Amount(line.UnitPrice, DocumentText.Decimals(line.UnitPrice)),
                DocumentText.Amount(line.NetAmount ?? line.Amount, amounts),
                DocumentText.Amount(line.TaxAmount ?? 0m, amounts),
                DocumentText.Amount(line.Amount, amounts),
            }).ToArray(), "Sin líneas.");
        var totals = new DocumentTotal[]
        {
            new("Subtotal", DocumentText.Amount(net, amounts)),
            new(OtherChargesLabel, DocumentText.Amount(other, amounts)),
            new($"ITBIS {FinanceInvoicePolicy.ItbisRate:0} %", DocumentText.Amount(tax, amounts)),
            new($"Total {invoice.CurrencyCode}", DocumentText.Amount(invoice.Total, amounts), true),
        };
        FiscalClosing(writer, totals, $"{fiscal.FiscalNumber}|{fiscal.SecurityCode}|{invoice.Total}", fiscal.SecurityCode!,
            fiscal.SignedAt ?? invoice.IssuedAt);
        writer.Finish();
        return Save(document);
    }

    /// <summary>
    /// «Crédito a 30 días» when the invoice falls due after it is issued, «Contado» when it is due the same day or has no
    /// due date (the e-CF prints one or the other, G2).
    /// </summary>
    public static string PaymentCondition(DateOnly issuedOn, DateOnly? dueDate) =>
        dueDate is { } due && due > issuedOn
            ? $"Crédito a {DocumentText.Days(due.DayNumber - issuedOn.DayNumber)} · vence el {DocumentText.Date(due)}"
            : "Contado";

    /// <summary>The security code and the simulated QR on the left, the totals block on the right.</summary>
    private static void FiscalClosing(DocumentPdfWriter writer, IReadOnlyList<DocumentTotal> totals, string seed,
        string securityCode, DateTimeOffset signedAt)
    {
        const double qr = 78;
        const double totalsWidth = 236;
        var height = Math.Max(writer.TotalsHeight(totals), qr);
        writer.Ensure(height + 8);
        var top = writer.Y;
        writer.Totals(totals, totalsWidth, top);
        var graphics = writer.Graphics;
        DrawSimulatedQr(graphics, seed, writer.Left, top, qr);
        var x = writer.Left + qr + 10;
        var width = writer.Width - totalsWidth - qr - 24;
        var y = top;
        foreach (var (text, bold) in new[]
        {
            ($"Código de seguridad {securityCode}", true),
            ($"Firma digital simulada el {DocumentText.LocalStamp(signedAt)}", false),
            ("QR de consulta simulado: no se valida ante la DGII.", false),
        })
            foreach (var line in writer.Wrap(text, bold ? writer.Bold : writer.Body, width))
            {
                graphics.DrawString(line, bold ? writer.Bold : writer.Body, new XSolidBrush(bold ? DocumentPalette.Navy : DocumentPalette.Muted),
                    new XRect(x, y, width, writer.LineHeight), XStringFormats.TopLeft);
                y += writer.LineHeight;
            }
        writer.Y = Math.Max(top + height, y) + 12;
    }

    /// <summary>
    /// The buyer's identifier frozen at issue: «RNC del comprador 1-31-23456-9», or «Id. fiscal del comprador … (país)»
    /// for a foreign airline; null for invoices issued before the airline had one.
    /// </summary>
    public static string? BuyerTaxRegistration(NonFiscalInvoiceFiscalData fiscal)
    {
        ArgumentNullException.ThrowIfNull(fiscal);
        return BuyerTaxRegistration(fiscal.CustomerTaxRegistration, fiscal.CustomerTaxRegistrationCountryCode);
    }

    private static string? BuyerTaxRegistration(string? number, string? countryCode)
    {
        if (string.IsNullOrWhiteSpace(number) || string.IsNullOrWhiteSpace(countryCode)) return null;
        var display = TaxRegistrations.Display(number, countryCode);
        return display.StartsWith("RNC ", StringComparison.Ordinal)
            ? "RNC del comprador " + display[4..]
            : "Id. fiscal del comprador " + display["Id. fiscal ".Length..];
    }

    /// <summary>A deterministic QR-like 21×21 pattern; it encodes nothing a reader could validate.</summary>
    private static void DrawSimulatedQr(XGraphics graphics, string seed, double x, double y, double size)
    {
        const int cells = 21;
        var cell = size / cells;
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(seed));
        var brush = new XSolidBrush(DocumentPalette.Navy);
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

    /// <summary>4-N10: EMISIÓN and the signature date are the business day in Santo Domingo, as the screens show (dd/MM/yyyy).</summary>
    private static string Date(DateTimeOffset value) => DocumentText.Date(value);

    /// <summary>The local time of the document in Santo Domingo, marked as such (4-N10).</summary>
    private static string Stamp(DateTimeOffset value) => DocumentText.LocalStamp(value);

    /// <summary>
    /// The receipt of a recorded payment: the payer, the day and the method, the invoice it settles with its total, the
    /// amount received and the balance the invoice had left when the receipt was produced.
    /// </summary>
    public byte[] RenderReceipt(NonFiscalPaymentData payment, string invoiceNumber)
    {
        ArgumentNullException.ThrowIfNull(payment);
        if (string.IsNullOrWhiteSpace(invoiceNumber) ||
            string.IsNullOrWhiteSpace(payment.Reference) || payment.CurrencyCode.Length != 3 ||
            payment.Amount <= 0)
            throw new ArgumentException("The payment snapshot is incomplete.", nameof(payment));

        using var document = new PdfDocument();
        document.Info.Title = $"Recibo de pago {payment.Reference}";
        document.Info.Subject = "NonFiscal payment receipt; not an external settlement";
        document.Info.Author = "ELEVANT";
        var invoice = payment.InvoiceFiscalNumber is { } fiscalNumber ? $"e-NCF {fiscalNumber} (interno {invoiceNumber})" : invoiceNumber;
        var writer = new DocumentPdfWriter(document,
            new DocumentLetterhead("RECIBO DE PAGO", payment.Reference,
                ["AVIAM Ltd. · Servicios de asistencia en tierra"], $"Recibo de pago {payment.Reference}"),
            new DocumentFooter("Recibo de un pago registrado por Finanzas de AVIAM. No sustituye la factura ni tiene validez fiscal."));
        ReceiptBody(writer, payment.PayerName ?? "No registrado", payment.PaidOn is { } paidOn ? DocumentText.Date(paidOn) : Date(payment.RecordedAt),
            DocumentText.PaymentMethod(payment.Method), payment.Reference, invoice, payment.CurrencyCode, payment.Amount,
            payment.InvoiceTotal, payment.Balance, payment.BalanceOn, Stamp(payment.RecordedAt));
        writer.Finish();
        return Save(document);
    }

    /// <summary>ADR-0036: the receipt of an approved simulated card payment, with the same parts as every receipt.</summary>
    public byte[] RenderCardReceipt(CardPaymentReceiptData receipt)
    {
        ArgumentNullException.ThrowIfNull(receipt);
        using var document = new PdfDocument();
        document.Info.Title = $"Recibo de pago {receipt.AuthorizationCode} · factura {receipt.FiscalNumber ?? receipt.InvoiceNumber}";
        document.Info.Subject = FinanceInvoicePolicy.Disclaimer;
        document.Info.Author = "ELEVANT";
        var writer = new DocumentPdfWriter(document,
            new DocumentLetterhead("RECIBO DE PAGO CON TARJETA", receipt.ReceiptReference,
                [$"Autorización {receipt.AuthorizationCode}"], $"Recibo de pago con tarjeta {receipt.ReceiptReference}"),
            new DocumentFooter($"{FinanceInvoicePolicy.Disclaimer}. Pago simulado: no se movió dinero real.")
            {
                LegendColor = DocumentPalette.Orange,
            });
        writer.Notice($"{FinanceInvoicePolicy.Disclaimer}: pago con tarjeta simulado; no se movió dinero real.");
        var invoice = receipt.FiscalNumber is null ? receipt.InvoiceNumber : $"e-NCF {receipt.FiscalNumber} (interno {receipt.InvoiceNumber})";
        ReceiptBody(writer, receipt.AirlineName, Date(receipt.PaidAt), $"Tarjeta {receipt.Brand} terminada en {receipt.Last4}",
            $"{receipt.ReceiptReference} · autorización {receipt.AuthorizationCode}", invoice, receipt.CurrencyCode, receipt.Amount,
            receipt.InvoiceTotal, receipt.Balance, receipt.BalanceOn, Stamp(receipt.PaidAt));
        writer.Finish();
        return Save(document);
    }

    private static void ReceiptBody(DocumentPdfWriter writer, string payer, string paidOn, string method, string reference,
        string invoice, string currency, decimal amount, decimal? invoiceTotal, decimal? balance, DateOnly? balanceOn,
        string recordedAt)
    {
        writer.Boxes([
            new("Recibimos de", [payer]),
            new("La suma de", [Money(amount, currency)], Accent: true),
        ]);
        writer.Facts([
            ("Fecha del pago", paidOn), ("Método", method), ("Referencia", reference), ("Registrado", recordedAt),
        ]);
        writer.Section("Aplicación del pago");
        var decimals = DocumentText.Decimals(new[] { amount, invoiceTotal ?? 0m, balance ?? 0m });
        writer.Table(
            [new("Factura", Weight: 2), new("Total de la factura", true), new("Este pago", true),
                new(balanceOn is { } on ? $"Saldo pendiente al {DocumentText.Date(on)}" : "Saldo pendiente", true)],
            [[
                invoice, invoiceTotal is { } total ? DocumentText.Amount(total, decimals) : "No registrado",
                DocumentText.Amount(amount, decimals), balance is { } left ? DocumentText.Amount(left, decimals) : "No registrado",
            ]], "Sin factura.");
        writer.Paragraph($"Importes en {currency}. El saldo pendiente es el de la factura en la fecha indicada, después de este " +
            "pago y de los demás cobros y notas registrados.", color: DocumentPalette.Muted);
    }

    /// <summary>
    /// 4-N17: a credit or debit note. One that modifies an E31 invoice prints its own e-NCF (E34 credit, E33 debit),
    /// the e-NCF it modifies, the reason in full, the buyer's RNC, the net, ITBIS and total frozen per line, a security
    /// code and a simulated QR; an older note (TC-/TD-) prints its lines. Every page says «Simulación — sin validez fiscal».
    /// </summary>
    public byte[] RenderAdjustmentNote(FinanceAdjustmentNoteDocumentData note)
    {
        ArgumentNullException.ThrowIfNull(note);
        if (string.IsNullOrWhiteSpace(note.Number) || note.Lines is null || note.Lines.Count == 0 ||
            note.CurrencyCode.Length != 3 || note.Amount <= 0)
            throw new ArgumentException("The adjustment note snapshot is incomplete.", nameof(note));
        var credit = note.Kind == "Credit";
        var fiscal = FinanceInvoicePolicy.IsFiscalNumber(note.Number, FinanceInvoicePolicy.NoteFiscalPrefix(credit));
        var kindLabel = credit ? "Nota de crédito" : "Nota de débito";
        using var document = new PdfDocument();
        document.Info.Title = fiscal ? $"{kindLabel} electrónica {note.Number}" : $"{kindLabel} {note.Number}";
        document.Info.Subject = FinanceInvoicePolicy.Disclaimer;
        document.Info.Author = "ELEVANT";
        var net = note.Lines.Sum(line => line.NetAmount ?? line.Amount);
        var tax = note.Lines.All(line => line.TaxAmount is not null) ? note.Lines.Sum(line => line.TaxAmount!.Value) : (decimal?)null;
        var modifies = note.InvoiceFiscalNumber is null ? note.InvoiceNumber : $"{note.InvoiceFiscalNumber} (interno {note.InvoiceNumber})";
        var securityCode = fiscal ? FinanceInvoicePolicy.SecurityCode(note.Number, note.Amount, note.IssuedAt, note.CustomerCode) : null;
        var title = (fiscal ? $"{kindLabel} electrónica" : kindLabel).ToUpperInvariant();
        var writer = new DocumentPdfWriter(document,
            new DocumentLetterhead(title, fiscal ? $"e-NCF {note.Number}" : note.Number, [$"Modifica: {modifies}"],
                $"{(fiscal ? $"{kindLabel} electrónica" : kindLabel)} {note.Number}"),
            new DocumentFooter($"{FinanceInvoicePolicy.Disclaimer}. {note.IssuerName} · RNC {note.IssuerRnc} · {note.Number}.")
            {
                LegendColor = DocumentPalette.Orange,
            });
        writer.Notice(SimulationNotice);
        writer.Boxes([
            new("Emisor", [note.IssuerName, $"RNC {note.IssuerRnc}", $"Estación {note.StationCode}"]),
            new("Comprador", [note.CustomerName, BuyerTaxRegistration(note.CustomerTaxRegistration, note.CustomerTaxRegistrationCountryCode)
                ?? "Identificación fiscal no registrada"], Accent: true),
        ]);
        writer.Facts([
            ("Emisión", Date(note.IssuedAt)), ("Vigencia", DocumentText.Date(note.EffectiveOn)),
            ("Comprobante modificado", modifies), ("Moneda", note.CurrencyCode),
        ]);
        writer.Section("Motivo");
        writer.Paragraph(string.IsNullOrWhiteSpace(note.Reason) ? "No registrado." : note.Reason.Trim());
        writer.Space(6);
        var decimals = DocumentText.Decimals(note.Lines.SelectMany(line => new[]
            { line.NetAmount ?? line.Amount, line.TaxAmount ?? 0m, line.Amount }).Append(note.Amount));
        writer.Table(
            [new("Operación", Weight: 1), new("Servicio o cargo", Weight: 2.2), new("Cant.", true), new("Neto", true),
                new("ITBIS", true), new($"Total ({note.CurrencyCode})", true)],
            note.Lines.Select(line => new[]
            {
                line.OperationCode, $"{line.ServiceName} ({line.ServiceCode})", DocumentText.Quantity(line.Quantity),
                DocumentText.Amount(line.NetAmount ?? line.Amount, decimals),
                line.TaxAmount is { } lineTax ? DocumentText.Amount(lineTax, decimals) : "—",
                DocumentText.Amount(line.Amount, decimals),
            }).ToArray(), "Sin líneas.");
        var other = tax is { } frozen ? note.Amount - net - frozen : 0m;
        DocumentTotal[] totals =
        [
            new("Subtotal", DocumentText.Amount(net, decimals)),
            new(OtherChargesLabel, DocumentText.Amount(other, decimals)),
            new("ITBIS", tax is { } total ? DocumentText.Amount(total, decimals) : "—"),
            new($"{(credit ? "TOTAL ACREDITADO" : "TOTAL DEBITADO")} {note.CurrencyCode}", DocumentText.Amount(note.Amount, decimals), true),
        ];
        if (securityCode is not null)
            FiscalClosing(writer, totals, $"{note.Number}|{securityCode}|{note.Amount}", securityCode, note.IssuedAt);
        else writer.Totals(totals, 236);
        writer.Finish();
        return Save(document);
    }

    /// <summary>
    /// PR E: the receipt of a treasury collection: who paid and how, the amount received, how it was applied to the
    /// airline's invoices (with the balance each one kept) and what remains available, refunded or reversed.
    /// </summary>
    public byte[] RenderTreasuryReceipt(FinanceTreasuryReceiptDocumentData receipt)
    {
        ArgumentNullException.ThrowIfNull(receipt);
        if (string.IsNullOrWhiteSpace(receipt.Reference) || receipt.CurrencyCode.Length != 3 || receipt.Amount <= 0)
            throw new ArgumentException("The treasury receipt is incomplete.", nameof(receipt));
        using var document = new PdfDocument();
        document.Info.Title = $"Recibo de cobro {receipt.Reference}";
        document.Info.Subject = "Recibo de cobro de Tesorería";
        document.Info.Author = "ELEVANT";
        var writer = new DocumentPdfWriter(document,
            new DocumentLetterhead("RECIBO DE COBRO", receipt.Reference,
                [$"Tesorería · AVIAM Ltd. · Estación {receipt.StationCode}"], $"Recibo de cobro {receipt.Reference}"),
            new DocumentFooter("Recibo de un cobro registrado por Tesorería de AVIAM. No sustituye la factura ni tiene validez fiscal."));
        if (receipt.Reversed)
            writer.Notice("COBRO REVERTIDO: este recibo ya no acredita pago; consulte el estado de cuenta.");
        writer.Boxes([
            new("Recibimos de", receipt.PayerTaxRegistration is { } tax ? [receipt.PayerName, tax] : [receipt.PayerName]),
            new("La suma de", [Money(receipt.Amount, receipt.CurrencyCode)], Accent: true),
        ]);
        writer.Facts([
            ("Fecha del cobro", DocumentText.Date(receipt.ReceivedOn)), ("Método", DocumentText.PaymentMethod(receipt.Method)),
            ("Registrado", $"{Stamp(receipt.RecordedAt)} por {receipt.RecordedBy}"), ("Moneda", receipt.CurrencyCode),
        ]);
        if (receipt.Notes is { Length: > 0 } notes)
        {
            writer.Section("Concepto");
            writer.Paragraph(notes.Trim());
            writer.Space(6);
        }
        writer.Section("Aplicación a facturas");
        var decimals = DocumentText.Decimals(receipt.Applications.SelectMany(item => new[]
            { item.ReceiptAmount, item.InvoiceAmount, item.InvoiceBalance ?? 0m }).Concat([receipt.Amount, receipt.Applied]));
        writer.Table(
            [new("Factura", Weight: 1.6), new("Fecha", Weight: 0.9), new($"Aplicado ({receipt.CurrencyCode})", true),
                new("En la moneda de la factura", true), new("Saldo de la factura", true)],
            receipt.Applications.Select(item => new[]
            {
                item.InvoiceNumber, DocumentText.Date(item.EffectiveOn), DocumentText.Amount(item.ReceiptAmount, decimals),
                $"{item.InvoiceCurrency} {DocumentText.Amount(item.InvoiceAmount, decimals)}",
                item.InvoiceBalance is { } balance ? $"{item.InvoiceCurrency} {DocumentText.Amount(balance, decimals)}" : "—",
            }).ToArray(), "Este cobro todavía no se ha aplicado a ninguna factura.");
        writer.Totals([
            new("Recibido", DocumentText.Amount(receipt.Amount, decimals)),
            new("Aplicado a facturas", DocumentText.Amount(receipt.Applied, decimals)),
            new("Reembolsado", DocumentText.Amount(receipt.Refunded, decimals)),
            new($"Disponible {receipt.CurrencyCode}", DocumentText.Amount(receipt.Available, decimals), true),
        ], 260);
        writer.Finish();
        return Save(document);
    }

    /// <summary>
    /// PR E: the statement of account of an airline at a cut-off date: the customer header, the aging of the balance,
    /// the open invoices and the movements with their running balance.
    /// </summary>
    public byte[] RenderStatement(FinanceStatementDocumentData statement)
    {
        ArgumentNullException.ThrowIfNull(statement);
        if (string.IsNullOrWhiteSpace(statement.CustomerName) || statement.CurrencyCode.Length != 3)
            throw new ArgumentException("The statement is incomplete.", nameof(statement));
        using var document = new PdfDocument();
        document.Info.Title = $"Estado de cuenta {statement.CustomerName} al {DocumentText.Date(statement.AsOf)}";
        document.Info.Subject = "Estado de cuenta de aerolínea";
        document.Info.Author = "ELEVANT";
        var currency = statement.CurrencyCode;
        var writer = new DocumentPdfWriter(document,
            new DocumentLetterhead("ESTADO DE CUENTA", $"Al {DocumentText.Date(statement.AsOf)}",
                [$"Finanzas · AVIAM Ltd. · Generado el {DocumentText.LocalStamp(statement.GeneratedAt)} por {statement.GeneratedBy}"],
                $"Estado de cuenta de {statement.CustomerName} al {DocumentText.Date(statement.AsOf)}"),
            new DocumentFooter($"Estado de cuenta de {statement.CustomerName} al {DocumentText.Date(statement.AsOf)} · {currency}. " +
                "Las facturas simuladas no tienen validez fiscal."));
        var customer = new List<string> { statement.CustomerName, $"Código {statement.CustomerCode}" };
        if (statement.CustomerTaxRegistration is { Length: > 0 } tax) customer.Insert(1, tax);
        writer.Boxes([
            new("Cliente", customer),
            new("Saldo al corte", [Money(statement.Aging.Balance, currency),
                statement.StationLabel is { } station ? $"Estación {station}" : "Todas las estaciones",
                statement.From is { } from ? $"Movimientos del {DocumentText.Date(from)} al {DocumentText.Date(statement.AsOf)}"
                    : $"Movimientos hasta el {DocumentText.Date(statement.AsOf)}"], Accent: true),
        ]);
        var aging = statement.Aging;
        var agingDecimals = DocumentText.Decimals(new[] { aging.Current, aging.Days1To30, aging.Days31To60, aging.Days61To90,
            aging.Days91Plus, aging.Unallocated, aging.CreditBalance, aging.Balance });
        writer.Section("Antigüedad de saldos");
        writer.Table(
            [new("Por vencer", true), new("1-30 días", true), new("31-60 días", true), new("61-90 días", true),
                new("Más de 90 días", true), new("Cobros sin aplicar", true), new("Saldo a favor", true), new($"Saldo ({currency})", true)],
            [[
                DocumentText.Amount(aging.Current, agingDecimals), DocumentText.Amount(aging.Days1To30, agingDecimals),
                DocumentText.Amount(aging.Days31To60, agingDecimals), DocumentText.Amount(aging.Days61To90, agingDecimals),
                DocumentText.Amount(aging.Days91Plus, agingDecimals), DocumentText.Amount(aging.Unallocated, agingDecimals),
                DocumentText.Amount(aging.CreditBalance, agingDecimals), DocumentText.Amount(aging.Balance, agingDecimals),
            ]], "Sin saldo.");
        writer.Section("Facturas abiertas");
        var invoiceDecimals = DocumentText.Decimals(statement.OpenInvoices.SelectMany(item => new[] { item.Total, item.Balance }));
        writer.Table(
            [new("Factura", Weight: 1.6), new("Emisión", Weight: 0.9), new("Vencimiento", Weight: 0.9), new("Días vencida", true),
                new($"Total ({currency})", true), new($"Saldo ({currency})", true)],
            statement.OpenInvoices.Select(item => new[]
            {
                item.Number, DocumentText.Date(item.IssuedOn), item.DueDate is { } due ? DocumentText.Date(due) : "—",
                item.DaysOverdue > 0 ? DocumentText.Quantity(item.DaysOverdue) : "—",
                DocumentText.Amount(item.Total, invoiceDecimals), DocumentText.Amount(item.Balance, invoiceDecimals),
            }).ToArray(), "Sin facturas abiertas al corte.",
            statement.OpenInvoices.Count == 0 ? null :
            [[
                $"Total · {DocumentText.Count(statement.OpenInvoices.Count, "factura", "facturas")}", "", "", "",
                DocumentText.Amount(statement.OpenInvoices.Sum(item => item.Total), invoiceDecimals),
                DocumentText.Amount(statement.OpenInvoices.Sum(item => item.Balance), invoiceDecimals),
            ]]);
        writer.Section("Movimientos");
        var running = statement.OpeningBalance;
        var movementDecimals = DocumentText.Decimals(statement.Movements.SelectMany(item => new[] { item.Debit, item.Credit })
            .Append(statement.OpeningBalance));
        var rows = new List<string[]>();
        if (statement.From is { } start)
            rows.Add([DocumentText.Date(start.AddDays(-1)), "—", "Saldo anterior", "", "", DocumentText.Amount(running, movementDecimals)]);
        foreach (var movement in statement.Movements)
        {
            running += movement.Debit - movement.Credit;
            rows.Add([
                DocumentText.Date(movement.Date), movement.Document, movement.Description,
                movement.Debit == 0 ? "" : DocumentText.Amount(movement.Debit, movementDecimals),
                movement.Credit == 0 ? "" : DocumentText.Amount(movement.Credit, movementDecimals),
                DocumentText.Amount(running, movementDecimals),
            ]);
        }
        writer.Table(
            [new("Fecha", Weight: 0.8), new("Documento", Weight: 1.4), new("Concepto", Weight: 2), new("Cargos", true),
                new("Abonos", true), new($"Saldo ({currency})", true)],
            rows, "Sin movimientos en el período.",
            statement.Movements.Count == 0 ? null :
            [[
                "Total del período", "", "", DocumentText.Amount(statement.Movements.Sum(item => item.Debit), movementDecimals),
                DocumentText.Amount(statement.Movements.Sum(item => item.Credit), movementDecimals),
                DocumentText.Amount(running, movementDecimals),
            ]]);
        writer.Paragraph("El saldo de cada movimiento acumula los cargos (facturas y notas de débito) menos los abonos (cobros y " +
            "notas de crédito). Los importes están en " + currency + ".", color: DocumentPalette.Muted);
        writer.Finish();
        return Save(document);
    }

    /// <summary>«USD 1,234.50»: thousands and two decimals, or the four a snapshot kept.</summary>
    private static string Money(decimal amount, string currency) => $"{currency} {Money(amount)}";

    private static string Money(decimal amount) => DocumentText.Amount(amount, DocumentText.Decimals(amount));

    private static byte[] Save(PdfDocument document)
    {
        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }
}
