using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Infrastructure.Messaging;
using Microsoft.Extensions.Options;

namespace Elevant.UnitTests.Infrastructure;

public sealed class SmtpEmailSenderLiveTests
{
    [Fact]
    public void WithoutAHostSendingIsDisabled()
    {
        var sender = new SmtpEmailSender(Options.Create(new SmtpOptions { FromAddress = "no-reply@example.test" }));

        Assert.False(sender.IsConfigured);
        Assert.False(new SmtpEmailSender(Options.Create(new SmtpOptions { Host = "smtp.example.test", FromAddress = "nope" })).IsConfigured);
    }

    /// <summary>
    /// Real send through the configured SMTP account to itself, the same path the API uses on the
    /// VPS. Runs only with ELEVANT_LIVE_SMTP=1 and the Smtp__* variables; CI never sends email.
    /// </summary>
    [Fact]
    public async Task LiveSmtpAccountSendsToItself()
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_LIVE_SMTP") != "1") return;
        var options = new SmtpOptions
        {
            Host = Environment.GetEnvironmentVariable("Smtp__Host"),
            Port = int.Parse(Environment.GetEnvironmentVariable("Smtp__Port") ?? "587", System.Globalization.CultureInfo.InvariantCulture),
            UseTls = Environment.GetEnvironmentVariable("Smtp__UseTls") != "false",
            Username = Environment.GetEnvironmentVariable("Smtp__Username"),
            Password = Environment.GetEnvironmentVariable("Smtp__Password"),
            FromAddress = Environment.GetEnvironmentVariable("Smtp__FromAddress"),
        };
        var sender = new SmtpEmailSender(Options.Create(options));
        Assert.True(sender.IsConfigured);

        // ELEVANT_LIVE_SMTP_TO sends a preview of every branded email to that inbox; otherwise one test to itself.
        var to = Environment.GetEnvironmentVariable("ELEVANT_LIVE_SMTP_TO") is { Length: > 0 } preview ? preview : options.FromAddress!;
        var link = "https://elevant.example.test/activar?token=vista-previa-sin-validez";
        EmailMessage[] messages = to == options.FromAddress
            ? [AccountEmailTemplates.Test(to, DateTimeOffset.UtcNow)]
            : [AccountEmailTemplates.Activation(to, "Erick", "Demo Airlines", link), AccountEmailTemplates.LoginCode(to, "246810"),
                AccountEmailTemplates.PasswordReset(to, link.Replace("activar", "recuperar")), AccountEmailTemplates.Test(to, DateTimeOffset.UtcNow)];
        foreach (var message in messages)
            await sender.SendAsync(message, TestContext.Current.CancellationToken);
    }
}
