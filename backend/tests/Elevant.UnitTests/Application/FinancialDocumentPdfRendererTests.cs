using Elevant.Application.Finance;
using Elevant.Infrastructure.Finance;
using PdfSharp.Pdf.IO;
using System.Security.Cryptography;
using System.Reflection;

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
    public void FiscalInvoiceCarriesEcfIdentityAndSimulationLegend()
    {
        var signedAt = new DateTimeOffset(2026, 11, 5, 14, 0, 0, TimeSpan.Zero);
        var invoice = new NonFiscalInvoiceData(
            Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
            "DEV-NF-2026-00000000000000000000002", "USD", 118m, signedAt,
            [new NonFiscalInvoiceLineData(Guid.NewGuid(), 1, "DEV-TAT-0001", new DateOnly(2026, 11, 5), "RAMP",
                "Asistencia en rampa", 1m, "servicio", 100m, 118m, 100m, 18m)],
            new NonFiscalInvoiceFiscalData("E310000000001", "ABC234", signedAt, new DateOnly(2026, 12, 5), 100m, 18m,
                "AVIAM Ltd.", FinanceInvoicePolicy.SimulatedIssuerRnc, "Aerolínea Demo S.A.", "SDQ"));

        var pdf = new FinancialDocumentPdfRenderer().RenderInvoice(invoice);

        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.Single(document.Pages);
        Assert.Contains("E310000000001", document.Info.Title);
        Assert.Equal(FinanceInvoicePolicy.Disclaimer, document.Info.Subject);
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

    [Theory]
    [InlineData("125.5000", "125.50")]
    [InlineData("0.0001", "0.0001")]
    [InlineData("12,345.6789", "12,345.6789")]
    public void FinancialPdfAmountRetainsSnapshotPrecision(string input, string expected)
    {
        var amount = decimal.Parse(input, System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture);
        var money = typeof(FinancialDocumentPdfRenderer).GetMethod("Money",
            BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(money);
        Assert.Equal(expected, money.Invoke(null, [amount]));
    }

    /// <summary>4-N10: EMISIÓN is the business day and the frame time is Santo Domingo's, marked «hora RD».</summary>
    [Fact]
    public void DocumentDatesAreTheBusinessDayAndTheLocalTimeOfSantoDomingo()
    {
        var evening = new DateTimeOffset(2026, 12, 1, 1, 30, 0, TimeSpan.Zero);
        var date = typeof(FinancialDocumentPdfRenderer).GetMethod("Date", BindingFlags.NonPublic | BindingFlags.Static);
        var stamp = typeof(FinancialDocumentPdfRenderer).GetMethod("Stamp", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(date);
        Assert.NotNull(stamp);
        Assert.Equal("2026-11-30", date.Invoke(null, [evening]));
        Assert.Equal("2026-11-30 21:30 hora RD", stamp.Invoke(null, [evening]));
        // A late-evening invoice still renders.
        var invoice = new NonFiscalInvoiceData(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
            "DEV-NF-2026-00000000000000000000003", "USD", 118m, evening,
            [new NonFiscalInvoiceLineData(Guid.NewGuid(), 1, "DEV-TAT-0001", new DateOnly(2026, 11, 30), "RAMP",
                "Asistencia en rampa", 1m, "servicio", 100m, 118m, 100m, 18m)],
            new NonFiscalInvoiceFiscalData("E310000000003", "ABC234", evening, new DateOnly(2026, 12, 30), 100m, 18m,
                "AVIAM Ltd.", FinanceInvoicePolicy.SimulatedIssuerRnc, "Aerolínea Demo S.A.", "SDQ"));
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(new FinancialDocumentPdfRenderer().RenderInvoice(invoice), 0, 5));
    }

    /// <summary>
    /// 4-N17: the note on an E31 invoice prints its own e-NCF E34, the e-NCF it modifies, the frozen net and ITBIS of
    /// each line and the simulation frame; an older TC- note prints its lines without inventing a tax.
    /// </summary>
    [Fact]
    public void AdjustmentNoteCarriesItsEcfTheInvoiceItModifiesAndTheFrozenItbis()
    {
        var issuedAt = new DateTimeOffset(2026, 11, 8, 15, 0, 0, TimeSpan.Zero);
        var note = new Elevant.Application.Abstractions.Finance.FinanceAdjustmentNoteDocumentData(Guid.NewGuid(),
            "E340000000001", "Credit", Guid.NewGuid(), "DEV-NF-2026-0001", "E310000000007", "USD", 59m,
            new DateOnly(2026, 11, 8), issuedAt, "Servicio cobrado de más", "AVIAM Ltd.", FinanceInvoicePolicy.SimulatedIssuerRnc,
            "Aerolínea Demo S.A.", "AAL", "PUJ",
            [new Elevant.Application.Abstractions.Finance.FinanceAdjustmentNoteDocumentLineData(1, "DEV-TAT-0001", "GPU",
                "Planta eléctrica", 0.5m, 59m, 50m, 9m, 18m)]);

        var pdf = new FinancialDocumentPdfRenderer().RenderAdjustmentNote(note);

        using (var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import))
        {
            Assert.Single(document.Pages);
            Assert.Equal("Nota de crédito electrónica E340000000001", document.Info.Title);
            Assert.Equal(FinanceInvoicePolicy.Disclaimer, document.Info.Subject);
        }
        var text = PdfFontInspector.Text(pdf);
        Assert.Contains("e-NCF E340000000001", text);
        Assert.Contains("Modifica: E310000000007", text);
        Assert.Contains(FinanceInvoicePolicy.Disclaimer, text);
        Assert.Contains("TOTAL ACREDITADO", text);
        Assert.Contains("50.00", text);
        Assert.Contains("9.00", text);
        Assert.Contains("Código de seguridad " + FinanceInvoicePolicy.SecurityCode("E340000000001", 59m, issuedAt, "AAL"), text);

        var legacy = new FinancialDocumentPdfRenderer().RenderAdjustmentNote(note with
        {
            Number = "TD-0190f0e0a0b0c0d0e0f0a0b0c0d0e0f0", Kind = "Debit", InvoiceFiscalNumber = null,
            Lines = [note.Lines[0] with { NetAmount = null, TaxAmount = null, TaxRate = null }],
        });
        var legacyText = PdfFontInspector.Text(legacy);
        Assert.Contains("TOTAL DEBITADO", legacyText);
        Assert.Contains("Modifica: DEV-NF-2026-0001", legacyText);
        Assert.DoesNotContain("Código de seguridad", legacyText);
        Assert.DoesNotContain("e-NCF", legacyText);
        Assert.Throws<ArgumentException>(() => new FinancialDocumentPdfRenderer().RenderAdjustmentNote(note with { Lines = [] }));
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
