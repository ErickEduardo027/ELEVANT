using System.Net.Mail;
using System.Net.Sockets;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Messaging;
using Microsoft.Extensions.Options;

namespace Elevant.UnitTests.Application;

/// <summary>
/// 1-N09 and 1-N22: a queued link or code expires with its token, and a failure is stored as a
/// normalized reason, never as the provider's text.
/// </summary>
public sealed class EmailOutboxRulesTests
{
    [Fact]
    public void QueuedSecretsExpireWithTheirTokenAndDocumentsNever()
    {
        Assert.Equal(TimeSpan.FromHours(72), EmailOutboxLifetimes.For(EmailPurpose.Activation));
        Assert.Equal(TimeSpan.FromMinutes(10), EmailOutboxLifetimes.For(EmailPurpose.LoginCode));
        Assert.Equal(TimeSpan.FromMinutes(30), EmailOutboxLifetimes.For(EmailPurpose.PasswordReset));
        foreach (var purpose in new[] { EmailPurpose.ContractActivated, EmailPurpose.InvoiceIssued,
                     EmailPurpose.PaymentReceived, EmailPurpose.CommercialDecision, EmailPurpose.Test,
                     // Phase 2, block B: notices without a one-time secret never expire in the queue.
                     EmailPurpose.ContractReadyToSign, EmailPurpose.PermitRejected, EmailPurpose.PermitRevoked,
                     EmailPurpose.PermitExpiring, EmailPurpose.ContractExpiring, EmailPurpose.ContractSuspended })
            Assert.Null(EmailOutboxLifetimes.For(purpose));
        Assert.Equal(new[] { EmailPurpose.Activation, EmailPurpose.LoginCode, EmailPurpose.PasswordReset },
            EmailOutboxLifetimes.Expiring.Select(item => item.Purpose));

        var created = new DateTimeOffset(2026, 11, 6, 10, 0, 0, TimeSpan.Zero);
        Assert.False(EmailOutboxLifetimes.IsExpired(EmailPurpose.LoginCode, created, created.AddMinutes(9)));
        Assert.True(EmailOutboxLifetimes.IsExpired(EmailPurpose.LoginCode, created, created.AddMinutes(10)));
        Assert.False(EmailOutboxLifetimes.IsExpired(EmailPurpose.InvoiceIssued, created, created.AddYears(1)));
    }

    [Fact]
    public void StoredReasonsAreCodesAndOlderFreeTextReadsAsAGenericFailure()
    {
        Assert.Null(EmailDeliveryReasons.Normalize(null));
        Assert.Null(EmailDeliveryReasons.Normalize(" "));
        Assert.Equal("superseded", EmailDeliveryReasons.Normalize("superseded"));
        Assert.Equal("send_failed", EmailDeliveryReasons.Normalize("SmtpException: 5.7.8 Username and Password not accepted"));
        Assert.Equal("send_failed", EmailSendException.For("not-a-code").Reason);
        Assert.DoesNotContain("@", EmailSendException.For(EmailDeliveryReasons.SmtpRejected).Message);
    }

    [Theory]
    [InlineData("recipient", "smtp_rejected")]
    [InlineData("credentials", "smtp_authentication")]
    [InlineData("application-password", "smtp_authentication")]
    [InlineData("refused", "smtp_rejected")]
    [InlineData("busy", "smtp_unavailable")]
    [InlineData("connection", "smtp_unavailable")]
    [InlineData("transport", "smtp_unavailable")]
    [InlineData("wrapped-timeout", "smtp_unavailable")]
    [InlineData("other", "send_failed")]
    public void SmtpFailuresBecomeNormalizedReasons(string failure, string reason)
    {
        Exception exception = failure switch
        {
            "recipient" => new SmtpFailedRecipientException(SmtpStatusCode.MailboxUnavailable, "ana@example.test"),
            "credentials" => new SmtpException((SmtpStatusCode)535, "5.7.8 Username and Password not accepted"),
            "application-password" => new SmtpException((SmtpStatusCode)534, "5.7.9 Application-specific password required"),
            "refused" => new SmtpException(SmtpStatusCode.TransactionFailed, "5.7.1 Message rejected"),
            "busy" => new SmtpException(SmtpStatusCode.ServiceNotAvailable, "4.4.2 Timeout"),
            "connection" => new SmtpException("Failure sending mail.", new SocketException(10061)),
            "transport" => new IOException("Unable to read data from the transport connection."),
            "wrapped-timeout" => new InvalidOperationException("outer", new TimeoutException()),
            _ => new InvalidOperationException("Something else."),
        };
        Assert.Equal(reason, SmtpFailureReasons.Of(exception));
    }

    [Fact]
    public async Task AnUnreachableServerFailsWithAReasonAndWithoutItsText()
    {
        using var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        var sender = new SmtpEmailSender(Options.Create(new SmtpOptions
        {
            Host = "127.0.0.1", Port = port, UseTls = false, FromAddress = "no-reply@example.test",
        }));

        var failure = await Assert.ThrowsAsync<EmailSendException>(() => sender.SendAsync(
            AccountEmailTemplates.Test("ana@example.test"), TestContext.Current.CancellationToken));
        Assert.Equal(EmailDeliveryReasons.SmtpUnavailable, failure.Reason);
        Assert.DoesNotContain("ana@example.test", failure.Message);
    }
}
