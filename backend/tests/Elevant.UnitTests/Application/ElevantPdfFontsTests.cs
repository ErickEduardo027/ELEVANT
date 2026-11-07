using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Finance;
using Elevant.Infrastructure.Commercial;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Operations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// 2-D: every PDF renderer (Finance, Gestión Humana, OCC and, as a regression, contracts) draws with the
/// shared Unicode faces: Type0 fonts with Identity-H encoding and the complete Noto Sans file embedded, so
/// «Aerolínea» prints with its accent instead of losing the composite glyph in a subset.
/// </summary>
public sealed class ElevantPdfFontsTests
{
    private static readonly DateTimeOffset At = new(2026, 11, 5, 14, 0, 0, TimeSpan.Zero);

    public static TheoryData<string> Renderers => new()
    {
        "invoice", "fiscal-invoice", "receipt", "card-receipt", "finance-report", "hr-report", "occ-report", "contract",
    };

    private static byte[] Render(string kind) => kind switch
    {
        "invoice" => new FinancialDocumentPdfRenderer().RenderInvoice(Invoice(fiscal: false)),
        "fiscal-invoice" => new FinancialDocumentPdfRenderer().RenderInvoice(Invoice(fiscal: true)),
        "receipt" => new FinancialDocumentPdfRenderer().RenderReceipt(
            new NonFiscalPaymentData(Guid.NewGuid(), Guid.NewGuid(), "PAGO-Aerolínea-001", "USD", 125.5m, At),
            "DEV-NF-2026-00000000000000000000001"),
        "card-receipt" => new FinancialDocumentPdfRenderer().RenderCardReceipt(new CardPaymentReceiptData(Guid.NewGuid(),
            "Aerolínea Demo", "DEV-NF-2026-00000000000000000000001", "E310000000001", "Visa", "4242", "ABC123", 118m, "USD",
            At, "REC-0001")),
        "finance-report" => new FinancialDocumentPdfRenderer().RenderReport(new FinanceReportData("aging", "Antigüedad",
            "Saldos por antigüedad", new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 5), null,
            [new FinanceReportMetric("Facturas", "1", "number")],
            [new FinanceReportColumn("airline", "Aerolínea", "text"), new FinanceReportColumn("balance", "Saldo", "money")],
            [["Aerolínea Demo", "118.00"]], ["Simulación sin validez fiscal."]), "Estación: PUJ"),
        "hr-report" => new HumanResourcesReportPdfRenderer().Render(new HumanResourcesReportSnapshot(
            HumanResourcesReportKind.StaffDistribution, Guid.NewGuid(), new DateOnly(2026, 11, 5), new DateOnly(2026, 11, 5), At,
            ["Agente", "Aerolínea"],
            [(IReadOnlyList<HumanResourcesReportCell>)[new("Ana Pérez", HumanResourcesReportCellType.Text),
                new("Aerolínea Demo", HumanResourcesReportCellType.Text)]]), "PUJ"),
        "occ-report" => new OccReportRenderer().RenderPdf(new OccReportTable(OccReportCatalog.Find("services-by-airline")!,
            Guid.NewGuid(), "PUJ", new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 5), At,
            [[new("Aerolínea Demo"), new("Asistencia en rampa"), new("operación"), OccReportCell.Number(2),
                OccReportCell.Number(2), OccReportCell.Number(2)]], 1, 50, false)),
        _ => new ContractPdfRenderer(new FixedTime(At)).Render(Contract()),
    };

    [Theory]
    [MemberData(nameof(Renderers))]
    public void EveryPdfEmbedsTheCompleteUnicodeFontsAndKeepsTheAccents(string kind)
    {
        var pdf = Render(kind);

        var fonts = PdfFontInspector.Fonts(pdf);
        Assert.NotEmpty(fonts);
        var regular = Elevant.Infrastructure.EmbeddedResources.Read("NotoSans-Regular.ttf").Length;
        var bold = Elevant.Infrastructure.EmbeddedResources.Read("NotoSans-Bold.ttf").Length;
        Assert.All(fonts, font =>
        {
            Assert.Equal("/Type0", font.Subtype);
            Assert.Equal("/Identity-H", font.Encoding);
            // The whole face travels (PdfSharp still tags its name): a subset is far smaller and loses the
            // components of composite glyphs such as «í».
            Assert.Contains(font.FontFileLength, new int?[] { regular, bold });
        });
        Assert.Contains("Aerolínea", PdfFontInspector.Text(pdf));
    }

    [Fact]
    public void TheSharedFontsUseUnicodeAndTheCompleteFontFile()
    {
        Assert.Equal(PdfSharp.Pdf.PdfFontEncoding.Unicode, ElevantPdfFonts.Embedding.FontEncoding);
        Assert.Equal(PdfSharp.Pdf.PdfFontEmbedding.EmbedCompleteFontFile, ElevantPdfFonts.Embedding.FontEmbedding);
        Assert.True(ElevantPdfFonts.Bold(9).Bold);
        Assert.False(ElevantPdfFonts.Regular(9).Bold);
    }

    private static NonFiscalInvoiceData Invoice(bool fiscal) => new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
        "DEV-NF-2026-00000000000000000000002", "USD", 118m, At,
        [new NonFiscalInvoiceLineData(Guid.NewGuid(), 1, "DEV-TAT-0001", new DateOnly(2026, 11, 5), "RAMP",
            "Atención a la Aerolínea", 1m, "servicio", 100m, 118m, 100m, 18m)],
        fiscal
            ? new NonFiscalInvoiceFiscalData("E310000000001", "ABC234", At, new DateOnly(2026, 12, 5), 100m, 18m, "AVIAM Ltd.",
                FinanceInvoicePolicy.SimulatedIssuerRnc, "Aerolínea Demo S.A.", "SDQ")
            : null);

    private static ContractDocumentData Contract() => new(Guid.NewGuid(), Guid.NewGuid(), "CTR-2026-000123", "Active",
        "Aerolínea Demo", "ZZ", "Aerolínea Demo S.R.L.", 1, "Approved", new DateOnly(2026, 11, 1), new DateOnly(2027, 10, 31), "USD",
        ["PUJ · Punta Cana"], [new ContractDocumentRate("RAMP", "Asistencia en rampa", "operation", 450m, 1m)],
        "La Aerolínea notifica a AVIAM cualquier cambio de itinerario.", new DateOnly(2026, 11, 2), []);

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
