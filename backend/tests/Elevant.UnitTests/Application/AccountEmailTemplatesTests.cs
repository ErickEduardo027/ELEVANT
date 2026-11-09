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
        // Phase 4, block C (4-N23): the invoice, its credit and debit notes and the overdue notice.
        "invoice-issued", "credit-note", "debit-note", "invoice-overdue",
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
        "invoice-issued" => AccountEmailTemplates.InvoiceIssued("ana@example.test", "Demo Airlines", "E310000000007", "USD",
            1180m, 300m, new DateOnly(2026, 12, 9)),
        "credit-note" => AccountEmailTemplates.AdjustmentNoteIssued("ana@example.test", "Demo Airlines", "E340000000002",
            true, "E310000000007", "USD", 118m),
        "debit-note" => AccountEmailTemplates.AdjustmentNoteIssued("ana@example.test", "Demo Airlines", "E330000000001",
            false, "E310000000007", "USD", 59m),
        "invoice-overdue" => AccountEmailTemplates.InvoiceOverdue("ana@example.test", "Demo Airlines", "E310000000007",
            new DateOnly(2026, 12, 9)),
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

    /// <summary>
    /// 4-N23: the billing emails never state a balance (it moves with payments and notes, and the airline reads it in the
    /// portal) nor any card data; they carry the simulation label. «Factura emitida» states the total, the due date and the
    /// prepayment the issuance applied; the notes name the invoice they modify.
    /// </summary>
    [Fact]
    public void BillingEmailsStateNoBalanceAndCarryTheSimulationLabel()
    {
        var issued = Render("invoice-issued");
        Assert.Contains("por USD 1,180.00, con vencimiento el 09/12/2026.", issued.TextBody);
        Assert.Contains("Al emitirla se aplicó el prepago confirmado por USD 300.00.", issued.TextBody);
        var unprepaid = AccountEmailTemplates.InvoiceIssued("ana@example.test", "Demo Airlines", "E310000000008", "USD",
            1180m, 0m, null);
        Assert.DoesNotContain("prepago", unprepaid.TextBody);
        Assert.Contains("por USD 1,180.00.", unprepaid.TextBody);

        var credit = Render("credit-note");
        Assert.Equal("Nota de crédito E340000000002 · factura E310000000007 · ELEVANT", credit.Subject);
        Assert.Contains("La nota reduce lo que se debe de esa factura.", credit.TextBody);
        var debit = Render("debit-note");
        Assert.Equal("Nota de débito E330000000001 · factura E310000000007 · ELEVANT", debit.Subject);
        Assert.Contains("La nota aumenta lo que se debe de esa factura.", debit.TextBody);
        var overdue = Render("invoice-overdue");
        Assert.Equal("Factura E310000000007 vencida · ELEVANT", overdue.Subject);
        Assert.Contains("venció el 09/12/2026", overdue.TextBody);

        foreach (var email in new[] { issued, unprepaid, credit, debit, overdue })
        {
            Assert.DoesNotContain("Saldo", email.TextBody);
            Assert.DoesNotContain("Saldo", email.HtmlBody);
            Assert.DoesNotContain("tarjeta", email.TextBody);
            Assert.Contains(Elevant.Application.Finance.FinanceInvoicePolicy.Disclaimer, email.TextBody);
            Assert.Contains("Consulta el saldo vigente", email.TextBody);
        }
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
