using Elevant.Application.Finance;

namespace Elevant.Application.Documents;

/// <summary>
/// The names of the PDF files of ELEVANT's documents, the same in every controller and email (PR E):
/// <c>factura-{e-NCF o número}.pdf</c>, <c>nota-credito-{n}.pdf</c> / <c>nota-debito-{n}.pdf</c>,
/// <c>recibo-{factura}-{n}.pdf</c> and <c>contrato-{código}-v{n}.pdf</c>.
/// </summary>
public static class DocumentFileNames
{
    public static string Invoice(string? fiscalNumber, string number) => Clean($"factura-{fiscalNumber ?? number}") + ".pdf";

    /// <summary>A note's file: <paramref name="kind"/> is «Credit» or «Debit».</summary>
    public static string AdjustmentNote(string kind, string number) =>
        Clean($"nota-{(kind == "Debit" ? "debito" : "credito")}-{number}") + ".pdf";

    /// <summary>A receipt's file: the invoice it settles (its e-NCF when it has one) and the receipt's own reference.</summary>
    public static string Receipt(string? invoiceFiscalNumber, string invoiceNumber, string reference) =>
        Clean($"recibo-{invoiceFiscalNumber ?? invoiceNumber}-{reference}") + ".pdf";

    public static string CardReceipt(CardPaymentReceiptData receipt)
    {
        ArgumentNullException.ThrowIfNull(receipt);
        return Receipt(receipt.FiscalNumber, receipt.InvoiceNumber, receipt.AuthorizationCode);
    }

    /// <summary>
    /// A contract version's file, <c>contrato-{código}-v{n}.pdf</c>; a draft whose code is still <c>DRAFT-{guid}</c> is
    /// <c>borrador-{8 primeros}-v{n}.pdf</c>.
    /// </summary>
    public static string Contract(string contractCode, int versionNumber, bool draft = false)
    {
        var code = contractCode.StartsWith("DRAFT-", StringComparison.Ordinal)
            ? contractCode["DRAFT-".Length..][..Math.Min(8, contractCode.Length - "DRAFT-".Length)].ToLowerInvariant()
            : contractCode;
        return Clean($"{(draft ? "borrador" : "contrato")}-{code}-v{versionNumber}") + ".pdf";
    }

    private static string Clean(string name) =>
        new(name.Trim().Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' or '.' ? character : '-')
            .ToArray());
}
