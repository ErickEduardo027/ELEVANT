using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;

namespace Elevant.UnitTests.Application;

/// <summary>
/// The simplified Finance (phase 4, block B): six reports, Spanish labels for what they export (4-N19) and the frame of
/// what the simulated e-CF produces (4-N20).
/// </summary>
public sealed class FinanceSimplificationTests
{
    private static readonly DateTimeOffset At = new(2026, 11, 5, 14, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TheCatalogHasExactlyTheSixApprovedReports()
    {
        Assert.Equal(["revenue", "receivables", "collections", "payables", "charges", "sales"],
            FinanceReports.All.Select(report => report.Key).ToArray());
        Assert.Equal("Ventas (e-CF simulado)", FinanceReports.All.Single(report => report.Key == "sales").Title);
        Assert.All(FinanceReports.All, report =>
        {
            Assert.False(string.IsNullOrWhiteSpace(report.Title));
            Assert.DoesNotContain("prefactura", report.Description, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("disputa", report.Description, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Theory]
    [InlineData(PaymentMethod.Transfer, "Transferencia")]
    [InlineData(PaymentMethod.Check, "Cheque")]
    [InlineData(PaymentMethod.Cash, "Efectivo")]
    [InlineData(PaymentMethod.Card, "Tarjeta")]
    [InlineData(PaymentMethod.Other, "Otro")]
    public void PaymentMethodsAreExportedInSpanish(PaymentMethod method, string label) =>
        Assert.Equal(label, FinanceLabels.PaymentMethod(method));

    /// <summary>
    /// 4-N20: the card receipt sits next to an e-NCF and the reports summarize e-CF invoices, so neither says «Sin NCF»:
    /// both are framed as a simulation without fiscal validity. The legacy non-fiscal receipt keeps its own frame.
    /// </summary>
    [Fact]
    public void SimulatedDocumentsAreFramedAsSimulationAndTheLegacyReceiptKeepsItsFrame()
    {
        var renderer = new FinancialDocumentPdfRenderer();
        var card = PdfFontInspector.Text(renderer.RenderCardReceipt(new CardPaymentReceiptData(Guid.NewGuid(),
            "Aerolínea Demo", "NF-0193f4c2", "E310000000001", "Visa", "4242", "ABC123", 118m, "USD", At, "REC-0001")));
        var report = PdfFontInspector.Text(renderer.RenderReport(new FinanceReportData("sales", "Ventas (e-CF simulado)",
            "Facturas e-CF del período.", new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 5), null,
            [new FinanceReportMetric("Facturas e-CF", "1", "number")],
            [new FinanceReportColumn("fiscalNumber", "e-NCF", "text"), new FinanceReportColumn("total", "Total", "money")],
            [["E310000000001", "118.00"]], []), "Período 2026-11-01 a 2026-11-05"));
        foreach (var text in new[] { card, report })
        {
            Assert.Contains("SIMULACIÓN — SIN VALIDEZ FISCAL", text);
            Assert.Contains(FinanceInvoicePolicy.Disclaimer, text);
            Assert.DoesNotContain("Sin NCF", text);
            Assert.DoesNotContain("DOCUMENTO NO FISCAL", text);
        }
        Assert.Contains("E310000000001", card);

        var legacy = PdfFontInspector.Text(renderer.RenderReceipt(
            new NonFiscalPaymentData(Guid.NewGuid(), Guid.NewGuid(), "PAGO-001", "USD", 125.5m, At), "NF-2026-0001"));
        Assert.Contains("DOCUMENTO NO FISCAL", legacy);
        Assert.Contains("Sin NCF", legacy);
    }
}
