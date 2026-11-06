using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Net.Sockets;
using System.Text;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Microsoft.Extensions.Options;

namespace Elevant.Infrastructure.Messaging;

/// <summary>
/// SMTP settings (section <c>Smtp</c>, ADR-0022). An empty <see cref="Host"/> disables sending:
/// emails then stay pending in the outbox. Credentials come only from the deployment secret store.
/// </summary>
public sealed class SmtpOptions
{
    public const string SectionName = "Smtp";

    public string? Host { get; set; }

    public int Port { get; set; } = 587;

    /// <summary>STARTTLS (Gmail on 587); false only for a local capture server such as Mailpit.</summary>
    public bool UseTls { get; set; } = true;

    public string? Username { get; set; }

    public string? Password { get; set; }

    public string? FromAddress { get; set; }

    public string FromName { get; set; } = "ELEVANT";

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Host) && Port is > 0 and < 65536 &&
        MailAddress.TryCreate(FromAddress, out _);
}

/// <summary>
/// Sends email through SMTP with an HTML body and a plain-text alternative. A failure surfaces as
/// <see cref="EmailSendException"/> with a normalized reason, never the server's text (1-N22).
/// </summary>
public sealed class SmtpEmailSender(IOptions<SmtpOptions> options) : IEmailSender
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);

    public bool IsConfigured => options.Value.IsConfigured;

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(message);
        var settings = options.Value;
        if (!settings.IsConfigured) throw new InvalidOperationException("SMTP is not configured.");

        using var mail = BuildMessage(message, settings);
        using var client = new SmtpClient(settings.Host, settings.Port)
        {
            EnableSsl = settings.UseTls,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = (int)Timeout.TotalMilliseconds,
            Credentials = string.IsNullOrEmpty(settings.Username) ? null
                : new NetworkCredential(settings.Username, settings.Password),
        };
        try
        {
            await client.SendMailAsync(mail, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw EmailSendException.For(SmtpFailureReasons.Of(exception), exception);
        }
    }

    /// <summary>
    /// Plain text plus an HTML alternative. When the HTML shows the ELEVANT logo
    /// (`cid:` + <see cref="AccountEmailTemplates.LogoContentId"/>), the logo travels inside the
    /// message, so it displays without loading anything from the internet.
    /// </summary>
    internal static MailMessage BuildMessage(EmailMessage message, SmtpOptions settings)
    {
        var mail = new MailMessage
        {
            From = new MailAddress(settings.FromAddress!, settings.FromName, Encoding.UTF8),
            Subject = message.Subject,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            Body = message.TextBody,
            IsBodyHtml = false,
        };
        mail.To.Add(new MailAddress(message.To));
        var html = AlternateView.CreateAlternateViewFromString(message.HtmlBody, Encoding.UTF8, MediaTypeNames.Text.Html);
        if (message.HtmlBody.Contains("cid:" + AccountEmailTemplates.LogoContentId, StringComparison.Ordinal))
            html.LinkedResources.Add(new LinkedResource(new MemoryStream(Logo.Value), MediaTypeNames.Image.Jpeg)
            {
                ContentId = AccountEmailTemplates.LogoContentId,
                TransferEncoding = TransferEncoding.Base64,
            });
        mail.AlternateViews.Add(html);
        foreach (var attachment in message.Attachments ?? [])
            mail.Attachments.Add(new Attachment(new MemoryStream(attachment.Content), attachment.FileName, attachment.ContentType));
        return mail;
    }

    private static readonly Lazy<byte[]> Logo = new(() => EmbeddedResources.Read("elevant-logo.jpg"));
}

/// <summary>
/// Normalized reason of an SMTP failure (1-N22): the outbox and the screens see a code, never the
/// exception text of the provider.
/// </summary>
public static class SmtpFailureReasons
{
    public static string Of(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return exception switch
        {
            SmtpFailedRecipientException => EmailDeliveryReasons.SmtpRejected,
            // 530 authentication required, 534 application password required, 535 credentials refused,
            // 454 temporary authentication failure.
            SmtpException { StatusCode: var code } when (int)code is 454 or 530 or 534 or 535 =>
                EmailDeliveryReasons.SmtpAuthentication,
            // Other 5xx answers are permanent refusals; 4xx answers and connection failures are transient.
            SmtpException { StatusCode: var code } when (int)code >= 500 => EmailDeliveryReasons.SmtpRejected,
            SmtpException => EmailDeliveryReasons.SmtpUnavailable,
            SocketException or IOException or TimeoutException or System.Security.Authentication.AuthenticationException =>
                EmailDeliveryReasons.SmtpUnavailable,
            { InnerException: { } inner } => Of(inner),
            _ => EmailDeliveryReasons.SendFailed,
        };
    }
}
