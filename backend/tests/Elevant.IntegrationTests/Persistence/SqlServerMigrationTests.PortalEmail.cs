using System.Text.RegularExpressions;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Enumerations;
using Elevant.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private const string EmailMigration = "20261102130658_AddEmailOutboxAndAccountTokens";
    private static readonly Guid PortalAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
    private const string PortalEmail = "airline.client@dev.elevant.test";

    [Fact]
    public async Task PortalEmailsCarryOneTimeCodesAndLinksThroughTheOutbox()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        (await SeededFinanceProviderAsync(database, ct)).Dispose();
        await using var provider = new ServiceCollection().AddLogging()
            .AddSingleton(TimeProvider.System)
            .AddSingleton(new AccountEmailOptions { PublicWebBaseUrl = "https://portal.example.test" })
            .AddPersistence(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
                { ["ConnectionStrings:ElevantDatabase"] = database.ConnectionString }).Build())
            .BuildServiceProvider();
        await using var context = CreateContext(database.ConnectionString);

        async Task<string> LatestBodyAsync(EmailPurpose purpose) =>
            (await context.Set<EmailOutboxMessage>().AsNoTracking().Where(item => item.Purpose == purpose)
                .OrderByDescending(item => item.Id).Select(item => item.TextBody).FirstAsync(ct))!;
        static string Code(string body) => Regex.Match(body, @"^(\d{6})\r?$", RegexOptions.Multiline).Groups[1].Value;
        static string Token(string body) => Regex.Match(body, @"token=([A-Za-z0-9_\-%]+)").Groups[1].Value;

        // Login code: five wrong attempts lock it; a new code works once.
        await using (var scope = provider.CreateAsyncScope())
        {
            var emails = scope.ServiceProvider.GetRequiredService<IAccountEmailStore>();
            var challenge = (await emails.IssueLoginCodeAsync(PortalAccount, ct))!;
            Assert.Equal("a••••t@dev.elevant.test", challenge.EmailHint);
            var code = Code(await LatestBodyAsync(EmailPurpose.LoginCode));
            Assert.Matches(@"^\d{6}$", code);
            var wrong = code == "000000" ? "111111" : "000000";
            for (var attempt = 0; attempt < AccountEmailOptions.MaximumCodeAttempts; attempt++)
                Assert.False((await emails.VerifyLoginCodeAsync(challenge.ChallengeId, wrong, ct)).IsSuccess);
            Assert.False((await emails.VerifyLoginCodeAsync(challenge.ChallengeId, code, ct)).IsSuccess);
            Assert.Null(await emails.ResendLoginCodeAsync(challenge.ChallengeId, ct));

            var fresh = (await emails.IssueLoginCodeAsync(PortalAccount, ct))!;
            var resent = (await emails.ResendLoginCodeAsync(fresh.ChallengeId, ct))!;
            Assert.Equal(fresh.ChallengeId, resent.ChallengeId);
            var current = Code(await LatestBodyAsync(EmailPurpose.LoginCode));
            var verified = await emails.VerifyLoginCodeAsync(fresh.ChallengeId, current, ct);
            Assert.Equal(PortalAccount, verified.AccountId);
            Assert.False((await emails.VerifyLoginCodeAsync(fresh.ChallengeId, current, ct)).IsSuccess);
        }

        // Password reset: unknown emails send nothing; the link is single use and checks the policy.
        await using (var scope = provider.CreateAsyncScope())
        {
            var emails = scope.ServiceProvider.GetRequiredService<IAccountEmailStore>();
            var before = await context.Set<EmailOutboxMessage>().CountAsync(ct);
            await emails.RequestPasswordResetAsync("nobody@example.test", ct);
            Assert.Equal(before, await context.Set<EmailOutboxMessage>().CountAsync(ct));
            await emails.RequestPasswordResetAsync(PortalEmail, ct);
            var token = Uri.UnescapeDataString(Token(await LatestBodyAsync(EmailPurpose.PasswordReset)));
            var stamp = await context.Users.AsNoTracking().Where(user => user.PublicId == PortalAccount)
                .Select(user => user.SecurityStamp).SingleAsync(ct);
            Assert.Equal(AccountEmailFailure.WeakPassword, (await emails.ResetPasswordAsync(token, "short", ct)).Failure);
            Assert.True((await emails.ResetPasswordAsync(token, "Synthetic-NewPassword!2026", ct)).IsSuccess);
            Assert.Equal(AccountEmailFailure.Invalid, (await emails.ResetPasswordAsync(token, "Synthetic-Again!2026x", ct)).Failure);
            Assert.NotEqual(stamp, await context.Users.AsNoTracking().Where(user => user.PublicId == PortalAccount)
                .Select(user => user.SecurityStamp).SingleAsync(ct));
        }

        // Invitation: an account that has not activated gets a link that confirms the email.
        await context.Users.Where(user => user.PublicId == PortalAccount).ExecuteUpdateAsync(update => update
            .SetProperty(user => user.InvitationStatus, InvitationStatus.Sent)
            .SetProperty(user => user.EmailConfirmed, false), ct);
        await using (var scope = provider.CreateAsyncScope())
        {
            var provisioning = scope.ServiceProvider.GetRequiredService<ICommercialProvisioningStore>();
            Assert.Equal(ProvisioningFailure.Forbidden,
                (await provisioning.ResendInvitationAsync(PortalAccount, PortalAccount, null, null, ct)).Failure);
            Assert.True((await provisioning.ResendInvitationAsync(Guid.Parse("40000000-0000-7000-8000-000000000007"),
                PortalAccount, null, null, ct)).IsSuccess);
            var link = await LatestBodyAsync(EmailPurpose.Activation);
            Assert.Contains("https://portal.example.test/activar?token=", link);
            var emails = scope.ServiceProvider.GetRequiredService<IAccountEmailStore>();
            Assert.True((await emails.ActivateAsync(Uri.UnescapeDataString(Token(link)), "Synthetic-Activated!2026", ct)).IsSuccess);
            var account = await context.Users.AsNoTracking().SingleAsync(user => user.PublicId == PortalAccount, ct);
            Assert.True(account.EmailConfirmed);
            Assert.Equal(InvitationStatus.Accepted, account.InvitationStatus);
            Assert.Equal(ProvisioningFailure.Conflict, (await provisioning.ResendInvitationAsync(
                Guid.Parse("40000000-0000-7000-8000-000000000007"), PortalAccount, null, null, ct)).Failure);
        }

        // Outbox: a claimed message is leased, and sending clears codes and links from the database.
        await using (var scope = provider.CreateAsyncScope())
        {
            var outbox = scope.ServiceProvider.GetRequiredService<IEmailOutboxStore>();
            var claimed = await outbox.ClaimDueAsync(100, ct);
            Assert.NotEmpty(claimed);
            Assert.Empty(await outbox.ClaimDueAsync(100, ct));
            await outbox.MarkSentAsync(claimed[0].Id, ct);
            var sent = await context.Set<EmailOutboxMessage>().AsNoTracking().SingleAsync(item => item.Id == claimed[0].Id, ct);
            Assert.Equal(EmailDeliveryStatus.Sent, sent.Status);
            Assert.Null(sent.HtmlBody);
            Assert.Null(sent.TextBody);
            Assert.Null(await outbox.ListRecentAsync(PortalAccount, 10, ct));
        }

        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, EmailMigration) - 1];
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52331, failure.Number);
    }
}
