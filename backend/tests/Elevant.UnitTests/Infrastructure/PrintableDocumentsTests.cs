using Elevant.Application.Documents;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Commercial;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Operations;
using Elevant.UnitTests.Application;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// PR E: every printable document at its best level. The professor's invoice (G2) and the common rules: nothing cut with
/// «...», dates dd/MM/yyyy, times in AVIAM's local zone, «Página X de Y», no demonstration labels.
/// </summary>
public sealed class PrintableDocumentsTests
{
    private static readonly FinancialDocumentPdfRenderer Finance = new();

    private static string Text(byte[] pdf) => PdfFontInspector.Text(pdf);

    /// <summary>The text with its lines joined, for phrases a paragraph may wrap.</summary>
    private static string Joined(string text) => string.Join(' ', text.Split('\n').Select(line => line.TrimEnd('\r')));

    private static int Pages(byte[] pdf)
    {
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        return document.PageCount;
    }

    private static void NothingIsCut(string text)
    {
        Assert.DoesNotContain("...", text);
        Assert.DoesNotContain("…", text);
    }

    [Fact]
    public void TheFiscalInvoiceHasTheTitleAsLargeAsItsEcfAndEveryLetterAtLeastNinePoints()
    {
        var pdf = Finance.RenderInvoice(DocumentSamples.FiscalInvoice());
        var runs = PdfFontInspector.Runs(pdf);
        var title = runs.Single(run => run.Text == FinancialDocumentPdfRenderer.FiscalInvoiceTitle);
        var number = runs.Single(run => run.Text == "e-NCF E310000000042");
        Assert.True(title.Size >= number.Size, $"title {title.Size} < e-NCF {number.Size}");
        Assert.True(title.Size >= 14);
        Assert.All(runs.Where(run => run.Text.Trim().Length > 0), run => Assert.True(run.Size >= 9, $"«{run.Text}» at {run.Size} pt"));
    }

    [Fact]
    public void TheFiscalInvoiceTotalsCarryOtherChargesAndTheirFiguresAlignToTheRight()
    {
        var invoice = DocumentSamples.FiscalInvoice();
        var text = Text(Finance.RenderInvoice(invoice));
        var lines = text.Split('\n').Select(line => line.TrimEnd('\r')).ToArray();
        Assert.Contains("Subtotal", lines);
        Assert.Contains(FinancialDocumentPdfRenderer.OtherChargesLabel, lines);
        Assert.Contains("ITBIS 18 %", lines);
        Assert.Contains("Total USD", lines);
        // Thousands and two decimals; «Otros cargos» prints 0.00 when there are none.
        Assert.Contains("0.00", lines);
        Assert.Contains(invoice.Total.ToString("#,##0.00", System.Globalization.CultureInfo.InvariantCulture), lines);
        Assert.Contains("RNC del comprador 1-31-23456-9", lines);
        Assert.Contains(DocumentSamples.LongAirline, Joined(text));
        NothingIsCut(text);
    }

    [Fact]
    public void TheFiscalInvoiceSeparatesIssueFromServiceDatesAndStatesThePaymentCondition()
    {
        var invoice = DocumentSamples.FiscalInvoice();
        var text = Text(Finance.RenderInvoice(invoice));
        Assert.Contains("EMISIÓN", text);
        // Issued at 01:30 UTC on the 21st: the business day in Santo Domingo is the 20th.
        Assert.Contains("20/11/2026", text);
        Assert.Contains("01/10/2026", text);
        Assert.Contains("CONDICIÓN DE PAGO", text);
        Assert.Contains("Crédito a 30 días · vence el 20/12/2026", Joined(text));
        Assert.Contains("Simulación — sin validez fiscal", text);
        Assert.DoesNotMatch(@"\d{4}-\d{2}-\d{2}", text);
        Assert.Equal("Contado", FinancialDocumentPdfRenderer.PaymentCondition(new DateOnly(2026, 11, 20), new DateOnly(2026, 11, 20)));
        Assert.Equal("Contado", FinancialDocumentPdfRenderer.PaymentCondition(new DateOnly(2026, 11, 20), null));
        Assert.Equal("Crédito a 1 día · vence el 21/11/2026",
            FinancialDocumentPdfRenderer.PaymentCondition(new DateOnly(2026, 11, 20), new DateOnly(2026, 11, 21)));
    }

    [Fact]
    public void ALongInvoiceRepeatsItsHeadingAndNumbersItsPages()
    {
        var pdf = Finance.RenderInvoice(DocumentSamples.FiscalInvoice(lines: 60));
        var text = Text(pdf);
        var pages = Pages(pdf);
        Assert.True(pages > 1);
        Assert.Contains($"Página 1 de {pages}", text);
        Assert.Contains($"Página {pages} de {pages}", text);
        Assert.Contains("Factura de crédito fiscal electrónica · e-NCF E310000000042 (continuación)", text);
        Assert.True(text.Split('\n').Count(line => line.TrimEnd('\r') == "Descripción") >= pages);
        NothingIsCut(text);
    }

    [Fact]
    public void TheLegacyInvoiceAndTheReceiptsHaveNoDemonstrationLabels()
    {
        var legacy = Text(Finance.RenderInvoice(DocumentSamples.LegacyInvoice()));
        Assert.DoesNotContain("Factura de prueba", legacy);
        Assert.DoesNotContain("TOTAL CONGELADO", legacy);
        Assert.Contains("FACTURA NO FISCAL", legacy);

        var receipt = Text(Finance.RenderReceipt(DocumentSamples.Payment(), "DEV-NF-2026-00000000000000000000042"));
        Assert.DoesNotContain("de prueba", receipt);
        Assert.Contains(DocumentSamples.LongAirline, Joined(receipt));
        Assert.Contains("Transferencia bancaria", receipt);
        Assert.Contains("20/11/2026", receipt);
        Assert.Contains("e-NCF E310000000042 (interno DEV-NF-2026-00000000000000000000042)", Joined(receipt));
        Assert.Contains("Saldo pendiente al 21/11/2026", Joined(receipt));
        Assert.Contains("1,615.57", receipt);
        NothingIsCut(receipt);

        var card = Text(Finance.RenderCardReceipt(DocumentSamples.CardReceipt()));
        Assert.DoesNotContain("de prueba", card);
        Assert.Contains("Tarjeta Visa terminada en 1111", Joined(card));
        Assert.Contains("Simulación — sin validez fiscal", card);
        Assert.Contains("Saldo pendiente al 21/11/2026", Joined(card));
    }

    [Fact]
    public void TheNotesPrintTheirReasonInFullAndTheBuyersRnc()
    {
        var note = DocumentSamples.CreditNote();
        var text = Text(Finance.RenderAdjustmentNote(note));
        Assert.Contains("RNC del comprador 1-31-23456-9", text);
        Assert.Contains("Modifica: E310000000042 (interno DEV-NF-2026-00000000000000000000042)", text);
        Assert.Contains("e-NCF E340000000011", text);
        // The reason wraps over several lines; every word of it is printed.
        var printed = string.Join(' ', text.Split('\n').Select(line => line.TrimEnd('\r')));
        Assert.Contains("registro del equipo.", printed);
        Assert.Contains("bitácora de la posición 14", printed);
        Assert.Contains(FinancialDocumentPdfRenderer.OtherChargesLabel, text);
        NothingIsCut(text);
        Assert.Contains("TOTAL DEBITADO", Text(Finance.RenderAdjustmentNote(DocumentSamples.DebitNote())));
    }

    [Fact]
    public void TheTreasuryReceiptListsItsApplicationsAndWhatRemains()
    {
        var text = Text(Finance.RenderTreasuryReceipt(DocumentSamples.TreasuryReceipt()));
        Assert.Contains("RECIBO DE COBRO", text);
        Assert.Contains("COB-PUJ-2026-000094", text);
        Assert.Contains("E310000000043", text);
        Assert.Contains("USD 1,200.00", text);
        Assert.Contains("Disponible USD", text);
        Assert.Contains("268.86", text);
        NothingIsCut(text);
    }

    [Fact]
    public void TheStatementCarriesAgingOpenInvoicesAndARunningBalance()
    {
        var statement = DocumentSamples.Statement(movements: 3);
        var text = Text(Finance.RenderStatement(statement));
        Assert.Contains("ESTADO DE CUENTA", text);
        Assert.Contains("Al 20/11/2026", text);
        Assert.Contains("Antigüedad de saldos", text);
        Assert.Contains("Facturas abiertas", text);
        Assert.Contains("Saldo anterior", text);
        // 3,200.00 + 1,234.56 + 1,244.56 − 1,850.25 = 3,828.87.
        Assert.Contains("4,434.56", text);
        Assert.Contains("5,679.12", text);
        Assert.Contains("3,828.87", text);
        Assert.Contains("Total · 9 facturas", text);
        NothingIsCut(text);
        var paged = Finance.RenderStatement(DocumentSamples.Statement());
        Assert.True(Pages(paged) > 1);
        Assert.Contains("(continuación)", Text(paged));
    }

    [Fact]
    public void TheContractRepeatsItsHeaderAndTableTitlesOnEveryPageInLocalTime()
    {
        var renderer = new ContractPdfRenderer(new FixedTime(DocumentSamples.IssuedAt));
        var pdf = renderer.Render(DocumentSamples.Contract());
        var text = Text(pdf);
        var pages = Pages(pdf);
        Assert.True(pages > 1);
        Assert.Equal(pages - 1, text.Split('\n').Count(line => line.TrimEnd('\r') == "Contrato CTR-2026-000123 · versión 2"));
        Assert.True(text.Split('\n').Count(line => line.TrimEnd('\r') == "Servicio") >= 2, "the rates table repeats its titles");
        var joined = Joined(text);
        Assert.DoesNotContain("UTC", text);
        Assert.Contains("Generado el 20/11/2026 21:30 (hora de Santo Domingo)", joined);
        Assert.Contains("Firmó el 20/11/2026 21:30 (hora de Santo Domingo)", joined);
        Assert.Contains("por 1 mes,", joined);
        Assert.Contains("1 día antes", joined);
        Assert.Contains("preaviso de 30 días", joined);
        Assert.DoesNotContain(" 1 meses", joined);
        Assert.DoesNotContain(" 1 días", joined);
        NothingIsCut(text);
    }

    [Fact]
    public void ADraftContractIsNamedByAReadableCode()
    {
        var draft = DocumentSamples.Contract("Draft", rates: 4, code: "DRAFT-1cc18541a9f04c2e8d7b6a5f4e3d2c1b");
        var text = Text(new ContractPdfRenderer().Render(draft));
        Assert.Contains("Borrador 1cc18541", text);
        Assert.DoesNotContain("DRAFT-", text);
        Assert.Equal("Borrador 1cc18541", ContractPdfRenderer.DisplayCode(draft.ContractCode));
        Assert.Equal("CTR-2026-000123", ContractPdfRenderer.DisplayCode("CTR-2026-000123"));
    }

    [Theory]
    [InlineData(OperationDocumentKind.ServiceOrder)]
    [InlineData(OperationDocumentKind.FlightReport)]
    [InlineData(OperationDocumentKind.BridgeChecklist)]
    [InlineData(OperationDocumentKind.CharterServiceRequest)]
    public void TheOperationFormsWrapInsteadOfCuttingAndNumberTheirPages(OperationDocumentKind kind)
    {
        var content = DocumentSamples.Operation(kind);
        var pdf = new OperationDocumentPdfRenderer(new FixedTime(DocumentSamples.IssuedAt)).Render(content, new string('a', 64),
            DocumentSamples.Signatures(kind), new Dictionary<Guid, DamagePhoto>());
        var text = Text(pdf);
        NothingIsCut(text);
        Assert.Contains($"{content.FormCode} · Página 1 de {Pages(pdf)}", text);
        Assert.Contains(content.FormRevision, text);
        if (kind == OperationDocumentKind.FlightReport) Assert.Contains("Supervisor", text);
        if (kind is OperationDocumentKind.FlightReport or OperationDocumentKind.BridgeChecklist)
            Assert.Contains(OperationDocumentPdfRenderer.NotRecorded, text);
        if (kind == OperationDocumentKind.CharterServiceRequest)
        {
            var joined = string.Join(' ', text.Split('\n').Select(line => line.TrimEnd('\r')));
            Assert.Contains("Véase la página 2.", joined);
            Assert.Contains("See page 2.", joined);
            Assert.DoesNotContain("page 3", joined);
            Assert.Equal(2, Pages(pdf));
        }
    }

    [Fact]
    public void DocumentFilesAreNamedTheSameEverywhere()
    {
        Assert.Equal("factura-E310000000042.pdf", DocumentFileNames.Invoice("E310000000042", "DEV-NF-1"));
        Assert.Equal("factura-DEV-NF-1.pdf", DocumentFileNames.Invoice(null, "DEV-NF-1"));
        Assert.Equal("nota-credito-E340000000011.pdf", DocumentFileNames.AdjustmentNote("Credit", "E340000000011"));
        Assert.Equal("nota-debito-E330000000003.pdf", DocumentFileNames.AdjustmentNote("Debit", "E330000000003"));
        Assert.Equal("recibo-E310000000042-TRF-BHD-2026-118842.pdf",
            DocumentFileNames.Receipt("E310000000042", "DEV-NF-1", "TRF-BHD-2026-118842"));
        Assert.Equal("recibo-E310000000042-AUTH-731904.pdf", DocumentFileNames.CardReceipt(DocumentSamples.CardReceipt()));
        Assert.Equal("contrato-CTR-2026-000123-v2.pdf", DocumentFileNames.Contract("CTR-2026-000123", 2));
        Assert.Equal("borrador-1cc18541-v1.pdf", DocumentFileNames.Contract("DRAFT-1CC18541A9F04C2E8D7B6A5F4E3D2C1B", 1, draft: true));
        Assert.Equal("recibo-E31-A-B-C.pdf", DocumentFileNames.Receipt("E31", "x", "A/B C"));
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
