using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Commercial;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Operations;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The visual review of PR E, like <see cref="ReportSamplesHarness"/> for the reports: with
/// <c>ELEVANT_DOCUMENT_SAMPLES_DIR</c> set, writes every printable document (invoices, notes, receipts, statement,
/// contract and the operation forms) with <see cref="DocumentSamples"/>. Without it the test only renders them.
/// </summary>
public sealed class DocumentSamplesHarness
{
    [Fact]
    public void EveryDocumentRendersAsPdf()
    {
        var directory = Environment.GetEnvironmentVariable("ELEVANT_DOCUMENT_SAMPLES_DIR");
        if (directory is { Length: > 0 }) Directory.CreateDirectory(directory);
        foreach (var (name, render) in Documents())
        {
            var pdf = render();
            Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
            if (directory is { Length: > 0 }) File.WriteAllBytes(Path.Combine(directory, name + ".pdf"), pdf);
        }
    }

    private static IEnumerable<(string Name, Func<byte[]> Render)> Documents()
    {
        var finance = new FinancialDocumentPdfRenderer();
        var clock = new FixedTime(DocumentSamples.IssuedAt);
        yield return ("01-factura-e-cf", () => finance.RenderInvoice(DocumentSamples.FiscalInvoice()));
        yield return ("02-factura-e-cf-varias-paginas", () => finance.RenderInvoice(DocumentSamples.FiscalInvoice(lines: 60)));
        yield return ("03-factura-no-fiscal", () => finance.RenderInvoice(DocumentSamples.LegacyInvoice()));
        yield return ("04-nota-credito", () => finance.RenderAdjustmentNote(DocumentSamples.CreditNote()));
        yield return ("05-nota-debito", () => finance.RenderAdjustmentNote(DocumentSamples.DebitNote()));
        yield return ("06-recibo-pago", () => finance.RenderReceipt(DocumentSamples.Payment(), "DEV-NF-2026-00000000000000000000042"));
        yield return ("07-recibo-tarjeta", () => finance.RenderCardReceipt(DocumentSamples.CardReceipt()));
        yield return ("08-recibo-cobro-tesoreria", () => finance.RenderTreasuryReceipt(DocumentSamples.TreasuryReceipt()));
        yield return ("09-estado-de-cuenta", () => finance.RenderStatement(DocumentSamples.Statement()));
        var contracts = new ContractPdfRenderer(clock);
        yield return ("10-contrato-firmado", () => contracts.Render(DocumentSamples.Contract()));
        yield return ("11-contrato-borrador", () => contracts.Render(DocumentSamples.Contract("Draft", rates: 6,
            code: "DRAFT-1cc18541a9f04c2e8d7b6a5f4e3d2c1b")));
        var operations = new OperationDocumentPdfRenderer(clock);
        foreach (var (kind, name) in new[]
        {
            (OperationDocumentKind.ServiceOrder, "12-orden-de-servicio"), (OperationDocumentKind.FlightReport, "13-reporte-de-vuelo"),
            (OperationDocumentKind.BridgeChecklist, "14-checklist-puente"),
            (OperationDocumentKind.CharterServiceRequest, "15-solicitud-charter"),
        })
            yield return (name, () => operations.Render(DocumentSamples.Operation(kind), new string('a', 64),
                DocumentSamples.Signatures(kind), new Dictionary<Guid, DamagePhoto>()));
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
