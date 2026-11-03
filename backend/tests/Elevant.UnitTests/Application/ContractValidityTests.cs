using System.Buffers.Binary;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Commercial;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Infrastructure.Commercial;
using Elevant.Infrastructure.Messaging;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Application;

/// <summary>Validity step, drawn signatures and the signed-contract email (ADR-0025).</summary>
public sealed class ContractValidityTests
{
    private static readonly DateOnly Today = new(2026, 11, 3);
    private static readonly DateTimeOffset Now = new(2026, 11, 3, 15, 0, 0, TimeSpan.Zero);

    // 1×1 transparent PNG, as a canvas would produce (but tiny).
    private const string TinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    private static string? Check(DateOnly from, DateOnly? to, string mode = "Manual", int? months = null,
        int renewalNotice = 30, int terminationNotice = 60, string? terms = null, DateOnly? previousFrom = null) =>
        ContractValidity.Check(from, to, mode, months, renewalNotice, terminationNotice, terms, Today, previousFrom);

    [Fact]
    public void AcceptsATypicalYearWithAutomaticRenewal() =>
        Assert.Null(Check(Today, Today.AddYears(1).AddDays(-1), "Automatic", months: 12));

    [Theory]
    [InlineData("Yearly", "renewal_mode_invalid")]
    [InlineData("automatic", "renewal_mode_invalid")]
    public void RejectsUnknownRenewalModes(string mode, string code) =>
        Assert.Equal(code, Check(Today, Today.AddYears(1), mode));

    [Fact]
    public void ExplainsEachRule()
    {
        Assert.Equal("valid_to_required", Check(Today, null));
        Assert.Equal("dates_invalid", Check(Today, Today));
        Assert.Equal("valid_from_past", Check(Today.AddDays(-1), Today.AddYears(1)));
        Assert.Equal("renewal_term_required", Check(Today, Today.AddYears(1), "Automatic"));
        Assert.Equal("renewal_term_invalid", Check(Today, Today.AddYears(1), months: 61));
        Assert.Equal("renewal_notice_invalid", Check(Today, Today.AddDays(20), renewalNotice: 30, terminationNotice: 5));
        Assert.Equal("termination_notice_invalid", Check(Today, Today.AddYears(1), terminationNotice: 181));
        Assert.Equal("termination_terms_too_long", Check(Today, Today.AddYears(1), terms: new string('x', 4001)));
    }

    [Fact]
    public void ARenewalMayStartBeforeTodayOnlyAfterTheVersionItRenews()
    {
        var previous = Today.AddMonths(-11);
        Assert.Null(Check(Today.AddDays(-2), Today.AddYears(1), previousFrom: previous));
        Assert.Equal("valid_from_past", Check(previous, Today.AddYears(1), previousFrom: previous));
    }

    [Fact]
    public void DecodesOnlyRealPngsWithinTheLimits()
    {
        Assert.NotNull(ContractValidity.DecodeSignature(TinyPng));
        Assert.NotNull(ContractValidity.DecodeSignature("data:image/png;base64," + TinyPng));
        Assert.Null(ContractValidity.DecodeSignature(null));
        Assert.Null(ContractValidity.DecodeSignature("not base64!"));
        Assert.Null(ContractValidity.DecodeSignature(Convert.ToBase64String("GIF89a-not-a-png-at-all-really"u8.ToArray())));

        var wide = Convert.FromBase64String(TinyPng);
        BinaryPrimitives.WriteInt32BigEndian(wide.AsSpan(16, 4), 1201);
        Assert.Null(ContractValidity.DecodeSignature(Convert.ToBase64String(wide)));
        var huge = new byte[ContractValidity.MaximumSignatureBytes + 1];
        Convert.FromBase64String(TinyPng).CopyTo(huge, 0);
        Assert.Null(ContractValidity.DecodeSignature(Convert.ToBase64String(huge)));
    }

    [Fact]
    public void FinalCodesAreYearAndSequence()
    {
        Assert.Equal("CTR-2026-0007", ContractValidity.FinalCode(2026, 7));
        Assert.Equal("CTR-2027-12345", ContractValidity.FinalCode(2027, 12345));
        Assert.True(ContractValidity.IsDraftCode("DRAFT-3f2a"));
        Assert.False(ContractValidity.IsDraftCode("CTR-2026-0007"));
    }

    private static ContractDocumentData Document(ContractValidityTerms? validity = null,
        IReadOnlyList<ContractDocumentSignature>? signatures = null) => new(
        Guid.NewGuid(), Guid.NewGuid(), "CTR-2026-0007", "Draft", "Demo Airlines", "ZZ", null, 1, "Approved",
        Today, Today.AddYears(1).AddDays(-1), "USD", ["PUJ · Punta Cana"],
        [new ContractDocumentRate("RAMP", "Asistencia en rampa", "Por vuelo", 450m, 1m)],
        "La Aerolínea notifica los cambios de itinerario.", null, signatures ?? [], validity);

    [Fact]
    public void ValidityTermsJoinTheSignedHashOnlyWhenPresent()
    {
        var before = Document();
        var terms = new ContractValidityTerms("Automatic", 12, 60, 90, "Incumplimiento grave.", Now);
        var after = Document(terms);

        // A version confirmed before ADR-0025 keeps the exact hash it was signed with.
        Assert.Equal(ContractDocumentHash.Of(before with { Validity = null }), before.ContentSha256);
        Assert.NotEqual(before.ContentSha256, after.ContentSha256);
        Assert.NotEqual(after.ContentSha256, Document(terms with { RenewalNoticeDays = 30 }).ContentSha256);
        // The confirmation time is metadata, not signed content.
        Assert.Equal(after.ContentSha256, Document(terms with { ConfirmedAt = Now.AddDays(1) }).ContentSha256);
    }

    [Fact]
    public void ThePdfPrintsDrawnSignaturesAndTheRenewalTerms()
    {
        var png = Convert.FromBase64String(TinyPng);
        var terms = new ContractValidityTerms("Automatic", 12, 60, 90, "Incumplimiento grave.", Now);
        var unsigned = Document(terms);
        var document = unsigned with
        {
            Signatures =
            [
                new ContractDocumentSignature("Airline", "Casey Airline", "Director", Now, unsigned.ContentSha256, png),
                new ContractDocumentSignature("Aviam", "Ana Pérez", "Gerente comercial", Now, unsigned.ContentSha256, png),
            ],
        };

        var bytes = new ContractPdfRenderer(new FixedTimeProvider(Now)).Render(document);
        if (Environment.GetEnvironmentVariable("ELEVANT_PDF_PREVIEW_DIR") is { Length: > 0 } preview)
            File.WriteAllBytes(Path.Combine(preview, "contract-signed-drawn.pdf"), bytes);
        using var pdf = PdfReader.Open(new MemoryStream(bytes), PdfDocumentOpenMode.Import);
        Assert.True(pdf.PageCount >= 1);
    }

    [Fact]
    public void TheActivationEmailCarriesTheSignedPdf()
    {
        var email = AccountEmailTemplates.ContractActivated("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            Today, Today.AddYears(1));
        Assert.Contains("CTR-2026-0007", email.Subject);
        Assert.Contains("cid:elevant-logo", email.HtmlBody);
        Assert.Contains("PDF firmado", email.TextBody);

        var settings = new SmtpOptions { Host = "smtp.example.test", FromAddress = "no-reply@example.test" };
        using var message = SmtpEmailSender.BuildMessage(email with
        {
            Attachments = [new EmailAttachment("contrato-CTR-2026-0007-v1.pdf", "application/pdf", [1, 2, 3])],
        }, settings);
        var attachment = Assert.Single(message.Attachments);
        Assert.Equal(("contrato-CTR-2026-0007-v1.pdf", "application/pdf"), (attachment.Name, attachment.ContentType.MediaType));
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
