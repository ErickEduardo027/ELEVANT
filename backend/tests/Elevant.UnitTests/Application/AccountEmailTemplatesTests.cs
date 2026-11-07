using System.Net.Mail;
using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Infrastructure.Messaging;

namespace Elevant.UnitTests.Application;

public sealed class AccountEmailTemplatesTests
{
    private const string Link = "https://portal.example.test/activar?token=aB3-dE5_fG7hI9jK1lM3nO5pQ7rS9tU1";

    public static TheoryData<string> Kinds => new()
    {
        "activation", "code", "reset", "test", "request-approved", "request-rejected", "request-cancelled",
        // Phase 2, block B: the airline's contract and permit notices.
        "contract-activated", "contract-ready-to-sign", "permit-rejected", "permit-revoked", "permit-expiring",
        "contract-expiring", "contract-suspended",
        // Phase 2, block E: the representatives hear of every change of the portal users.
        "portal-user-changed",
    };

    private static EmailMessage Render(string kind) => kind switch
    {
        "activation" => AccountEmailTemplates.Activation("ana@example.test", "Ana", "Demo Airlines", Link),
        "code" => AccountEmailTemplates.LoginCode("ana@example.test", "246810"),
        "reset" => AccountEmailTemplates.PasswordReset("ana@example.test", Link.Replace("activar", "recuperar")),
        "request-approved" => AccountEmailTemplates.CommercialRequestApproved("ana@example.test", "Ana", "Demo Airlines",
            "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e"),
        "request-rejected" => AccountEmailTemplates.CommercialRequestRejected("ana@example.test", "Ana", "Demo Airlines",
            "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e", "No se acreditó la representación."),
        "request-cancelled" => AccountEmailTemplates.CommercialRequestCancelled("ana@example.test", "Ana", "Demo Airlines",
            "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e", "Solicitud duplicada."),
        "contract-activated" => AccountEmailTemplates.ContractActivated("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            new DateOnly(2026, 12, 1), new DateOnly(2027, 11, 30), new DateOnly(2026, 11, 6)),
        "contract-ready-to-sign" => AccountEmailTemplates.ContractReadyToSign("ana@example.test", "Demo Airlines",
            "CTR-2026-0007", 1, new DateOnly(2026, 12, 1), new DateOnly(2027, 11, 30), contractInForce: false),
        "permit-rejected" => AccountEmailTemplates.PermitRejected("ana@example.test", "Demo Airlines", "permiso de operación",
            "JAC-2026-001", "El documento no es legible."),
        "permit-revoked" => AccountEmailTemplates.PermitRevoked("ana@example.test", "Demo Airlines", "permiso de operación",
            "JAC-2026-001", "Se verificó por error.", ["CTR-2026-0007"]),
        "permit-expiring" => AccountEmailTemplates.PermitExpiring("ana@example.test", "Demo Airlines", "permiso de operación",
            "JAC-2026-001", new DateOnly(2026, 12, 6), operatingPermit: true),
        "contract-expiring" => AccountEmailTemplates.ContractExpiring("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            new DateOnly(2027, 1, 5), 12),
        "portal-user-changed" => AccountEmailTemplates.PortalUserChanged("ana@example.test", "Demo Airlines",
            "Se invitó a Luis Linares (luis@demo-air.test) como usuario del portal.", "Ana Rivera"),
        "contract-suspended" => AccountEmailTemplates.ContractSuspended("ana@example.test", "Demo Airlines", "CTR-2026-0007",
            Elevant.Application.Commercial.ContractSuspensionCause.PermitExpired),
        _ => AccountEmailTemplates.Test("ana@example.test", new DateTimeOffset(2026, 11, 2, 20, 17, 0, TimeSpan.Zero)),
    };

    [Theory]
    [MemberData(nameof(Kinds))]
    public void EveryEmailCarriesTheBrandLogoPaletteAndAPlainTextVersion(string kind)
    {
        var email = Render(kind);

        Assert.Contains("cid:elevant-logo", email.HtmlBody);
        Assert.Contains("#04142e", email.HtmlBody);
        Assert.Contains("#ff5c00", email.HtmlBody);
        Assert.Contains("No respondas a este mensaje", email.HtmlBody);
        Assert.Contains("No respondas a este mensaje", email.TextBody);
        Assert.DoesNotContain("<", email.TextBody);

        // Set ELEVANT_EMAIL_PREVIEW_DIR to keep the HTML for a visual review.
        if (Environment.GetEnvironmentVariable("ELEVANT_EMAIL_PREVIEW_DIR") is { Length: > 0 } preview)
            File.WriteAllText(Path.Combine(preview, $"email-{kind}.html"), email.HtmlBody);
    }

    [Fact]
    public void TheLoginCodeShowsOneBoxPerDigitAndStaysAloneInTheText()
    {
        var email = AccountEmailTemplates.LoginCode("ana@example.test", "246810");

        // 1-N09: the code never goes in the subject, which the outbox keeps after clearing the body.
        Assert.Equal(AccountEmailTemplates.LoginCodeSubject, email.Subject);
        Assert.DoesNotContain("246810", email.Subject);
        Assert.Equal(6, Regex.Matches(email.HtmlBody, "border:2px solid #1757d8").Count);
        Assert.Matches(new Regex(@"^246810\r?$", RegexOptions.Multiline), email.TextBody);
        Assert.Contains("Vence en 10 minutos", email.TextBody);
    }

    [Fact]
    public void LinksAppearInTheButtonAndAsAFallbackAndValuesAreEncoded()
    {
        var email = AccountEmailTemplates.Activation("ana@example.test", "<script>alert(1)</script>", "A&B Air", Link);

        Assert.Equal(2, Regex.Matches(email.HtmlBody, Regex.Escape($"href=\"{Link}\"")).Count);
        Assert.Contains($"Activar mi cuenta: {Link}", email.TextBody);
        Assert.DoesNotContain("<script>", email.HtmlBody);
        Assert.Contains("&lt;script&gt;", email.HtmlBody);
        Assert.Contains("A&amp;B Air", email.HtmlBody);
    }

    [Fact]
    public void TheRequestDecisionTellsTheReasonWithoutPuttingTheReferenceInTheSubject()
    {
        const string reference = "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";
        var rejected = AccountEmailTemplates.CommercialRequestRejected("ana@example.test", "Ana", "A&B Air", reference,
            "Faltan <b>códigos</b> ICAO válidos.");
        var cancelled = AccountEmailTemplates.CommercialRequestCancelled("ana@example.test", "Ana", "A&B Air", reference,
            "Solicitud duplicada.");
        var approved = AccountEmailTemplates.CommercialRequestApproved("ana@example.test", "Ana", "A&B Air", reference);

        foreach (var email in new[] { rejected, cancelled, approved })
        {
            Assert.DoesNotContain(reference, email.Subject);
            Assert.Contains(reference, email.TextBody);
            Assert.Contains("A&amp;B Air", email.HtmlBody);
            Assert.Equal("ana@example.test", email.To);
        }
        Assert.Contains("Motivo: Faltan <b>códigos</b> ICAO válidos.", rejected.TextBody);
        Assert.Contains("Faltan &lt;b&gt;", rejected.HtmlBody);
        Assert.DoesNotContain("<b>", rejected.HtmlBody);
        Assert.Contains("Motivo: Solicitud duplicada.", cancelled.TextBody);
        Assert.Contains("no fue aprobada", rejected.Subject);
        Assert.Contains("cancelada", cancelled.Subject);
        Assert.Contains("aprobada", approved.Subject);
        Assert.DoesNotContain("Motivo", approved.TextBody);
    }

    [Fact]
    public void TheSenderEmbedsTheLogoOnlyWhenTheHtmlUsesIt()
    {
        var settings = new SmtpOptions { Host = "smtp.example.test", FromAddress = "no-reply@example.test" };

        using var branded = SmtpEmailSender.BuildMessage(Render("code"), settings);
        var logo = Assert.Single(Assert.Single(branded.AlternateViews).LinkedResources);
        Assert.Equal(("elevant-logo", "image/jpeg"), (logo.ContentId, logo.ContentType.MediaType));
        Assert.True(logo.ContentStream.Length > 1000);

        using var plain = SmtpEmailSender.BuildMessage(new EmailMessage("ana@example.test", "Sin logo", "<p>Hola</p>", "Hola"), settings);
        Assert.Empty(Assert.Single(plain.AlternateViews).LinkedResources);
        Assert.Equal("Hola", plain.Body);
    }
}
