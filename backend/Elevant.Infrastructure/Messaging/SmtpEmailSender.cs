using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;
using Elevant.Application.Abstractions.Messaging;
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

/// <summary>Sends email through SMTP with an HTML body and a plain-text alternative.</summary>
public sealed class SmtpEmailSender(IOptions<SmtpOptions> options) : IEmailSender
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);

    public bool IsConfigured => options.Value.IsConfigured;

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(message);
        var settings = options.Value;
        if (!settings.IsConfigured) throw new InvalidOperationException("SMTP is not configured.");

        using var mail = new MailMessage
        {
            From = new MailAddress(settings.FromAddress!, settings.FromName, Encoding.UTF8),
            Subject = message.Subject,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            Body = message.TextBody,
            IsBodyHtml = false,
        };
        mail.To.Add(new MailAddress(message.To));
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.HtmlBody, Encoding.UTF8,
            MediaTypeNames.Text.Html));

        using var client = new SmtpClient(settings.Host, settings.Port)
        {
            EnableSsl = settings.UseTls,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = (int)Timeout.TotalMilliseconds,
            Credentials = string.IsNullOrEmpty(settings.Username) ? null
                : new NetworkCredential(settings.Username, settings.Password),
        };
        await client.SendMailAsync(mail, cancellationToken);
    }
}
