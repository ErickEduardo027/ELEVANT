using System.Security.Cryptography;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Commercial;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Application;

public sealed class RecordedContractPdfRendererTests
{
    private static readonly Guid CoveredService = Guid.Parse("10000000-0000-7000-8000-000000000001");

    [Fact]
    public void DraftUsesVersionedTemplateAndFrozenServiceCoverage()
    {
        var renderer = new RecordedContractPdfRenderer();
        var snapshot = Snapshot();

        var coverage = RecordedContractPdfRenderer.Coverage(snapshot);
        var draft = renderer.RenderDraft(snapshot);

        Assert.Equal("PKG-RAMP", coverage[CoveredService].Code);
        Assert.Single(coverage);
        Assert.Equal("contract-clauses-v1", renderer.TemplateVersion);
        Assert.Equal(64, renderer.TemplateSha256.Length);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(draft, 0, 5));
        using var pdf = PdfReader.Open(new MemoryStream(draft), PdfDocumentOpenMode.Import);
        Assert.True(pdf.PageCount >= 2);
        Assert.Contains(snapshot.ContractCode, pdf.Info.Title);
    }

    [Fact]
    public void AmbiguousPackageCoverageIsRejected()
    {
        var snapshot = Snapshot();
        var duplicate = snapshot.Packages[0] with
        { PackageVersionId = Guid.NewGuid(), Code = "PKG-SECOND" };
        snapshot = snapshot with { Packages = [.. snapshot.Packages, duplicate] };

        Assert.Throws<ArgumentException>(() => new RecordedContractPdfRenderer()
            .RenderDraft(snapshot));
    }

    [Fact]
    public void FinalAndEvidenceRequireBothAccountsOnTheSamePdfInOrder()
    {
        var renderer = new RecordedContractPdfRenderer();
        var snapshot = Snapshot();
        var draft = renderer.RenderDraft(snapshot);
        var hash = Convert.ToHexString(SHA256.HashData(draft)).ToLowerInvariant();
        var aviam = new ContractAcceptanceEvidence(Guid.NewGuid(), "Aviam", "AVIAM Signer",
            "aviam@example.test", new DateTimeOffset(2026, 10, 21, 14, 0, 0, TimeSpan.Zero), hash);
        var airline = new ContractAcceptanceEvidence(Guid.NewGuid(), "Airline", "Airline Signer",
            "airline@example.test", new DateTimeOffset(2026, 10, 21, 14, 5, 0, TimeSpan.Zero), hash);

        var final = renderer.RenderFinal(draft, aviam, airline);
        var evidence = renderer.RenderEvidence(snapshot, hash, aviam, airline);

        using var draftPdf = PdfReader.Open(new MemoryStream(draft), PdfDocumentOpenMode.Import);
        using var finalPdf = PdfReader.Open(new MemoryStream(final), PdfDocumentOpenMode.Import);
        using var auditPdf = PdfReader.Open(new MemoryStream(evidence), PdfDocumentOpenMode.Import);
        Assert.Equal(draftPdf.PageCount + 1, finalPdf.PageCount);
        Assert.Single(auditPdf.Pages);
        Assert.Contains("sin certificación externa", auditPdf.Info.Subject);
        Assert.Throws<ArgumentException>(() => renderer.RenderFinal(draft,
            aviam with { DraftSha256 = new string('0', 64) }, airline));
        Assert.Throws<ArgumentException>(() => renderer.RenderFinal(draft,
            aviam with { AcceptedAtUtc = airline.AcceptedAtUtc.AddMinutes(1) }, airline));
    }

    private static ContractPdfSnapshot Snapshot()
    {
        var covered = new ContractPdfService(CoveredService, "RAMP", "Asistencia en rampa",
            "operación", 150m, 1m);
        var separate = new ContractPdfService(Guid.NewGuid(), "GPU", "Unidad de potencia",
            "hora", 75m, 1m);
        var package = new ContractPdfPackage(Guid.NewGuid(), "PKG-RAMP", "Paquete rampa",
            1, 200m, "vuelo", [new ContractPdfPackageComponent(CoveredService,
                "RAMP", "Asistencia en rampa", "operación", 1m, 1m, 50m)]);
        return new ContractPdfSnapshot(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
            "CTR-2026-001", "REQ-2026-001", 1,
            new DateTimeOffset(2026, 10, 21, 13, 0, 0, TimeSpan.Zero),
            "AVIAM Ltd.", "Synthetic Airlines Ltd.", "SY",
            "AVIAM Signer", "aviam@example.test",
            "Airline Signer", "Representante autorizado", "airline@example.test",
            new DateOnly(2026, 10, 21), null, "USD", "Servicios acordados por estación.",
            [new ContractPdfStation("PUJ", "Punta Cana")],
            [covered, separate], [package]);
    }
}
