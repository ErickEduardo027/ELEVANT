using System.Net.Mail;
using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Infrastructure.Messaging;

namespace Elevant.UnitTests.Application;

public sealed class AccountEmailTemplatesTests
{
    private const string Link = "https://portal.example.test/activar?token=aB3-dE5_fG7hI9jK1lM3nO5pQ7rS9tU1";

    public static TheoryData<string> Kinds => new() { "activation", "code", "reset", "test" };

    private static EmailMessage Render(string kind) => kind switch
    {
        "activation" => AccountEmailTemplates.Activation("ana@example.test", "Ana", "Demo Airlines", Link),
        "code" => AccountEmailTemplates.LoginCode("ana@example.test", "246810"),
        "reset" => AccountEmailTemplates.PasswordReset("ana@example.test", Link.Replace("activar", "recuperar")),
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

        Assert.Contains("246810", email.Subject);
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
