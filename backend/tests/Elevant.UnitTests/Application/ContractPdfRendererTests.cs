using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Commercial;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Application;

public sealed class ContractPdfRendererTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 15, 30, 0, TimeSpan.Zero);

    private static ContractDocumentData Document(string status, bool confirmed = true, int terms = 40) => new(
        Guid.NewGuid(), Guid.NewGuid(), "CTR-2026-000123", "Active", "Demo Airlines", "ZZ", "Demo Airlines S.R.L.",
        2, status, new DateOnly(2026, 11, 1), new DateOnly(2027, 10, 31), "USD",
        ["SDQ · Las Américas", "PUJ · Punta Cana", "STI · Cibao"],
        [
            new ContractDocumentRate("RAMP", "Asistencia en rampa", "Por vuelo", 450m, 1m),
            new ContractDocumentRate("PAX", "Atención de pasajeros", "Por pasajero", 3.25m, 50m, confirmed),
            new ContractDocumentRate("GPU", "Unidad de potencia en tierra", "Por hora", 85m, 1m),
        ],
        string.Join('\n', Enumerable.Range(1, terms).Select(index =>
            $"La Aerolínea notifica a AVIAM cualquier cambio de itinerario con al menos 24 horas de anticipación (condición {index}).")),
        status == "Approved" ? new DateOnly(2026, 11, 2) : null,
        status == "Approved"
            ? [new ContractDocumentSignature("Aviam", "Ana Pérez", "Gerente comercial", Now, "placeholder")]
            : []);

    private static byte[] Render(ContractDocumentData document)
    {
        var pdf = new ContractPdfRenderer(new FixedTimeProvider(Now)).Render(document);
        // Set ELEVANT_PDF_PREVIEW_DIR to keep the files for a visual review.
        if (Environment.GetEnvironmentVariable("ELEVANT_PDF_PREVIEW_DIR") is { Length: > 0 } preview)
            File.WriteAllBytes(Path.Combine(preview, $"contract-{document.VersionStatus.ToLowerInvariant()}.pdf"), pdf);
        return pdf;
    }

    [Fact]
    public void ApprovedContractPaginatesWithItsCodeAndNoDraftMark()
    {
        var document = Document("Approved");
        var bytes = Render(document with { Signatures = [document.Signatures[0] with { DocumentSha256 = document.ContentSha256 }] });

        using var pdf = PdfReader.Open(new MemoryStream(bytes), PdfDocumentOpenMode.Import);
        Assert.True(pdf.PageCount > 1);
        Assert.Equal("Contrato CTR-2026-000123 · versión 2", pdf.Info.Title);
        Assert.False(ContractPdfRenderer.IsDraft(document));
    }

    [Theory]
    [InlineData("Draft")]
    [InlineData("PendingFinanceApproval")]
    public void DraftVersionsPrintAsWatermarkedReviewCopies(string status)
    {
        var document = Document(status, confirmed: false, terms: 3);

        using var pdf = PdfReader.Open(new MemoryStream(Render(document)), PdfDocumentOpenMode.Import);
        Assert.EndsWith("· borrador", pdf.Info.Title);
        Assert.True(ContractPdfRenderer.IsDraft(document));
    }

    [Fact]
    public void UnconfirmedPriceDoesNotChangeTheSignedFingerprint()
    {
        var confirmed = Document("Draft");
        var pending = confirmed with { Rates = confirmed.Rates.Select(rate => rate with { PriceConfirmed = false }).ToArray() };

        Assert.Equal(confirmed.ContentSha256, pending.ContentSha256);
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
