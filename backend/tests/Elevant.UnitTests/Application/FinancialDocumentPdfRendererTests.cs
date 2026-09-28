using Elevant.Application.Finance;
using Elevant.Infrastructure.Finance;
using PdfSharp.Pdf.IO;
using System.Security.Cryptography;

namespace Elevant.UnitTests.Application;

public sealed class FinancialDocumentPdfRendererTests
{
    [Fact]
    public void InvoiceUsesImmutableSnapshotAndPaginatesLongStatements()
    {
        var invoice = new NonFiscalInvoiceData(
            Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
            "DEV-NF-2026-00000000000000000000001", "USD", 600m,
            new DateTimeOffset(2026, 9, 28, 16, 0, 0, TimeSpan.Zero),
            Enumerable.Range(1, 60).Select(number => new NonFiscalInvoiceLineData(
                Guid.NewGuid(), number, $"DEV-TAT-{number:0000}",
                new DateOnly(2026, 9, 28), "RAMP", "Asistencia en rampa",
                1m, "servicio", 10m, 10m)).ToArray());

        var pdf = new FinancialDocumentPdfRenderer().RenderInvoice(invoice);

        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(pdf, 0, 5));
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.True(document.PageCount > 1);
        Assert.Contains(invoice.Number, document.Info.Title);
    }

    [Fact]
    public void ReceiptIsNonFiscalAndTiedToRecordedPayment()
    {
        var payment = new NonFiscalPaymentData(Guid.NewGuid(), Guid.NewGuid(),
            "DEV-PAY-2026-001", "USD", 125.50m,
            new DateTimeOffset(2026, 9, 28, 16, 30, 0, TimeSpan.Zero));

        var pdf = new FinancialDocumentPdfRenderer().RenderReceipt(payment,
            "DEV-NF-2026-00000000000000000000001");

        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(pdf, 0, 5));
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.Single(document.Pages);
        Assert.Contains(payment.Reference, document.Info.Title);
        Assert.Contains("NonFiscal", document.Info.Subject);
    }

    [Fact]
    public void StoredPdfMustMatchBothLengthAndSha256BeforeDownload()
    {
        var bytes = "%PDF-1.7\nbody\n%%EOF"u8.ToArray();
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        Assert.True(FinancialDocumentIntegrity.Matches(bytes, bytes.Length, hash));
        Assert.False(FinancialDocumentIntegrity.Matches(bytes, bytes.Length + 1, hash));
        Assert.False(FinancialDocumentIntegrity.Matches(bytes, bytes.Length,
            new string('0', 64)));
        Assert.False(FinancialDocumentIntegrity.Matches("not a PDF"u8.ToArray(),
            9, Convert.ToHexString(SHA256.HashData("not a PDF"u8.ToArray())).ToLowerInvariant()));
    }
}
