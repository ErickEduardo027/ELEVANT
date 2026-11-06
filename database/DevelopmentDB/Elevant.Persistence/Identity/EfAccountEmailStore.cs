using System.Security.Cryptography;
using System.Text;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// One-time email secrets of portal accounts (ADR-0022). Secrets are random, stored as SHA-256,
/// compared in constant time and used once; each email goes through the outbox in the same
/// transaction as the token that it carries.
/// </summary>
internal sealed class EfAccountEmailStore(ElevantDbContext context, UserManager<ApplicationUser> userManager,
    AccountEmailOptions options, TimeProvider timeProvider) : IAccountEmailStore
{
    public async Task<LoginChallenge?> IssueLoginCodeAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var account = await context.Users.AsNoTracking()
            .Where(user => user.PublicId == accountId && user.Status == AccountLifecycleStatus.Active &&
                user.EmailConfirmed && user.Email != null)
            .Select(user => new { user.Id, user.Email }).SingleOrDefaultAsync(cancellationToken);
        if (account is null) return null;
        return await NewChallengeAsync(account.Id, account.Email!, Guid.CreateVersion7(), cancellationToken);
    }

    public async Task<LoginChallenge?> ResendLoginCodeAsync(Guid challengeId, CancellationToken cancellationToken = default)
    {
        var now = Now();
        var pending = await (from token in context.Set<AccountEmailToken>().AsNoTracking()
                             join user in context.Users.AsNoTracking() on token.AccountId equals user.Id
                             where token.ChallengeId == challengeId && token.Purpose == EmailPurpose.LoginCode &&
                                   token.UsedAt == null && token.ExpiresAt > now &&
                                   token.Attempts < AccountEmailOptions.MaximumCodeAttempts &&
                                   user.Status == AccountLifecycleStatus.Active && user.Email != null
                             select new { token.AccountId, user.Email }).FirstOrDefaultAsync(cancellationToken);
        return pending is null ? null
            : await NewChallengeAsync(pending.AccountId, pending.Email!, challengeId, cancellationToken);
    }

    public async Task<AccountEmailResult> VerifyLoginCodeAsync(Guid challengeId, string code,
        CancellationToken cancellationToken = default)
    {
        var now = Now();
        var token = await context.Set<AccountEmailToken>()
            .Where(item => item.ChallengeId == challengeId && item.Purpose == EmailPurpose.LoginCode && item.UsedAt == null)
            .OrderByDescending(item => item.Id).FirstOrDefaultAsync(cancellationToken);
        if (token is null || token.ExpiresAt <= now || token.Attempts >= AccountEmailOptions.MaximumCodeAttempts)
            return Invalid();
        if (!Matches(token.SecretHash, Secret(challengeId, code)))
        {
            token.Attempts++;
            token.UpdatedAt = now;
            await context.SaveChangesAsync(cancellationToken);
            return Invalid();
        }
        token.UsedAt = now;
        token.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        var accountId = await context.Users.AsNoTracking().Where(user => user.Id == token.AccountId)
            .Select(user => user.PublicId).SingleAsync(cancellationToken);
        return new AccountEmailResult(accountId, null);
    }

    public Task<AccountEmailResult> ActivateAsync(string token, string newPassword, CancellationToken cancellationToken = default) =>
        SetPasswordAsync(token, newPassword, EmailPurpose.Activation, "identity.account.activated", cancellationToken);

    public async Task RequestPasswordResetAsync(string email, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email) || email.Length > 256) return;
        var normalized = email.Trim().ToUpperInvariant();
        // Only active portal accounts that already activated their email can reset by email.
        var account = await (from user in context.Users.AsNoTracking()
                             where user.NormalizedEmail == normalized && user.Status == AccountLifecycleStatus.Active &&
                                   user.EmailConfirmed && user.InvitationStatus == InvitationStatus.Accepted &&
                                   context.UserRoles.Any(link => link.UserId == user.Id &&
                                       context.Roles.Any(role => role.Id == link.RoleId && role.Portal == PortalKind.AirlinePortal))
                             select new { user.Id, user.Email }).SingleOrDefaultAsync(cancellationToken);
        if (account?.Email is null) return;
        var secret = RandomSecret();
        var link = options.Link("/recuperar", secret);
        if (link is null) return;
        AddToken(account.Id, EmailPurpose.PasswordReset, Guid.CreateVersion7(), Hash(secret),
            Now() + AccountEmailOptions.PasswordResetLifetime);
        Enqueue(AccountEmailTemplates.PasswordReset(account.Email, link), EmailPurpose.PasswordReset);
        await context.SaveChangesAsync(cancellationToken);
    }

    public Task<AccountEmailResult> ResetPasswordAsync(string token, string newPassword, CancellationToken cancellationToken = default) =>
        SetPasswordAsync(token, newPassword, EmailPurpose.PasswordReset, "identity.password.reset", cancellationToken);

    /// <summary>
    /// Retires every unused activation link of the account and discards its activation emails still
    /// in the queue, inside the caller's unit of work: a new link replaces them, or a temporary
    /// password closed the invitation (1-N09, 1-N12).
    /// </summary>
    internal static async Task RetireActivationAsync(ElevantDbContext context, ApplicationUser account, string reason,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var links = await context.Set<AccountEmailToken>()
            .Where(item => item.AccountId == account.Id && item.Purpose == EmailPurpose.Activation && item.UsedAt == null)
            .ToListAsync(cancellationToken);
        foreach (var link in links)
        {
            link.UsedAt = now;
            link.UpdatedAt = now;
        }
        if (account.Email is { } email)
            await EfEmailOutboxStore.DiscardPendingAsync(context, email, EmailPurpose.Activation, reason, now,
                cancellationToken);
    }

    /// <summary>
    /// Adds the activation token and its email for a new portal account, inside the caller's
    /// transaction. False when the portal origin is not configured.
    /// </summary>
    internal static bool AddActivation(ElevantDbContext context, AccountEmailOptions options, ApplicationUser account,
        string name, string airline, DateTimeOffset now)
    {
        var secret = RandomSecret();
        var link = options.Link("/activar", secret);
        if (link is null || account.Email is null) return false;
        context.Set<AccountEmailToken>().Add(new AccountEmailToken
        {
            PublicId = Guid.CreateVersion7(), AccountId = account.Id, Purpose = EmailPurpose.Activation,
            ChallengeId = Guid.CreateVersion7(), SecretHash = Hash(secret), ExpiresAt = now + AccountEmailOptions.ActivationLifetime,
            CreatedAt = now, UpdatedAt = now,
        });
        EfEmailOutboxStore.Add(context, AccountEmailTemplates.Activation(account.Email, name, airline, link),
            EmailPurpose.Activation, now);
        return true;
    }

    private async Task<AccountEmailResult> SetPasswordAsync(string token, string newPassword, EmailPurpose purpose,
        string auditAction, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 128 || string.IsNullOrEmpty(newPassword)) return Invalid();
        var now = Now();
        var hash = Hash(token);
        var row = await context.Set<AccountEmailToken>()
            .SingleOrDefaultAsync(item => item.SecretHash == hash && item.Purpose == purpose, cancellationToken);
        if (row is null || row.UsedAt is not null || row.ExpiresAt <= now) return Invalid();
        var account = await context.Users.SingleOrDefaultAsync(user => user.Id == row.AccountId &&
            user.Status == AccountLifecycleStatus.Active, cancellationToken);
        if (account is null) return Invalid();
        foreach (var validator in userManager.PasswordValidators)
            if (!(await validator.ValidateAsync(userManager, account, newPassword)).Succeeded)
                return new AccountEmailResult(null, AccountEmailFailure.WeakPassword);

        account.PasswordHash = userManager.PasswordHasher.HashPassword(account, newPassword);
        account.EmailConfirmed = true;
        account.InvitationStatus = InvitationStatus.Accepted;
        account.MustChangePassword = false;
        // A new stamp ends every token issued before (refresh tokens included).
        account.SecurityStamp = Guid.NewGuid().ToString("N");
        account.UpdatedAt = now;
        row.UsedAt = now;
        row.UpdatedAt = now;
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = account.Id, Action = auditAction, EntityType = "iam.accounts",
            EntityPublicId = account.PublicId, Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
        });
        await context.SaveChangesAsync(cancellationToken);
        return new AccountEmailResult(account.PublicId, null);
    }

    private async Task<LoginChallenge> NewChallengeAsync(long accountId, string email, Guid challengeId,
        CancellationToken cancellationToken)
    {
        var now = Now();
        // A new code retires the earlier ones of the account, and their emails still in the queue are
        // discarded: a late code would only burn attempts of the current one (1-N09).
        await context.Set<AccountEmailToken>()
            .Where(item => item.AccountId == accountId && item.Purpose == EmailPurpose.LoginCode && item.UsedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.UsedAt, now)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        await EfEmailOutboxStore.DiscardPendingAsync(context, email, EmailPurpose.LoginCode,
            EmailDeliveryReasons.Superseded, now, cancellationToken);
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
        var expiresAt = now + AccountEmailOptions.LoginCodeLifetime;
        AddToken(accountId, EmailPurpose.LoginCode, challengeId, Hash(Secret(challengeId, code)), expiresAt);
        Enqueue(AccountEmailTemplates.LoginCode(email, code), EmailPurpose.LoginCode);
        await context.SaveChangesAsync(cancellationToken);
        return new LoginChallenge(challengeId, Mask(email), expiresAt);
    }

    private void AddToken(long accountId, EmailPurpose purpose, Guid challengeId, string secretHash, DateTimeOffset expiresAt)
    {
        var now = Now();
        context.Set<AccountEmailToken>().Add(new AccountEmailToken
        {
            PublicId = Guid.CreateVersion7(), AccountId = accountId, Purpose = purpose, ChallengeId = challengeId,
            SecretHash = secretHash, ExpiresAt = expiresAt, CreatedAt = now, UpdatedAt = now,
        });
    }

    private void Enqueue(EmailMessage message, EmailPurpose purpose) => EfEmailOutboxStore.Add(context, message, purpose, Now());

    /// <summary>ana.perez@aerolinea.com → a••••z@aerolinea.com</summary>
    internal static string Mask(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0) return "••••";
        var local = email[..at];
        return (local.Length <= 2 ? local[..1] + "•" : $"{local[0]}••••{local[^1]}") + email[at..];
    }

    private static string Secret(Guid challengeId, string code) => $"{challengeId:N}:{code}";

    private static string RandomSecret() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static bool Matches(string storedHash, string secret) =>
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(storedHash), Encoding.ASCII.GetBytes(Hash(secret)));

    private static AccountEmailResult Invalid() => new(null, AccountEmailFailure.Invalid);

    private DateTimeOffset Now()
    {
        var now = timeProvider.GetUtcNow();
        return new DateTimeOffset(now.UtcTicks - now.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }
}
