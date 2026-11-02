using Elevant.Application.Abstractions.Messaging;
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

        await sender.SendAsync(new EmailMessage(options.FromAddress!, "ELEVANT · prueba del remitente (API)",
            "<p>Prueba del remitente no-reply de ELEVANT enviada por <code>SmtpEmailSender</code>.</p>",
            "Prueba del remitente no-reply de ELEVANT enviada por SmtpEmailSender."), TestContext.Current.CancellationToken);
    }
}
