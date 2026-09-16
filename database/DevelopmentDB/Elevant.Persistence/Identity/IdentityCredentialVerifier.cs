using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Elevant.Persistence.Identity;

/// <summary>Verifies an account password against the ASP.NET Core Identity store.</summary>
internal sealed class IdentityCredentialVerifier(
    ElevantDbContext context,
    UserManager<ApplicationUser> userManager,
    IPasswordHasher<ApplicationUser> passwordHasher,
    IOptions<IdentityOptions> identityOptions,
    TimeProvider timeProvider) : ICredentialVerifier
{
    private const string DummyPasswordHash =
        "AQAAAAIAAYagAAAAEEVMRVZBTlRkdW1teVNhbHSqJClmWmUG41RqSOWxNoNLwhvGpHYGmD5Hh1LXlfVtVA==";
    private static readonly ApplicationUser DummyAccount = new()
    {
        UserName = "constant-time-authentication-dummy",
    };

    public async Task<VerifiedCredential?> VerifyAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password))
        {
            return null;
        }

        cancellationToken.ThrowIfCancellationRequested();

        var normalizedEmail = userManager.NormalizeEmail(email.Trim());
        if (string.IsNullOrWhiteSpace(normalizedEmail))
        {
            return null;
        }

        var candidates = await context.Users
            .Where(account => account.NormalizedEmail == normalizedEmail)
            .Take(2)
            .ToArrayAsync(cancellationToken);

        if (candidates.Length != 1 ||
            candidates[0].Status != AccountLifecycleStatus.Active ||
            candidates[0].InvitationStatus != InvitationStatus.Accepted ||
            !candidates[0].EmailConfirmed ||
            !candidates[0].LockoutEnabled ||
            candidates[0].TwoFactorEnabled ||
            string.IsNullOrWhiteSpace(candidates[0].PasswordHash) ||
            string.IsNullOrWhiteSpace(candidates[0].SecurityStamp))
        {
            VerifyDummyPassword(password);
            return null;
        }

        var account = candidates[0];
        var verifiedPublicId = account.PublicId;
        var verifiedPersonId = account.PersonId;
        var verifiedNormalizedEmail = account.NormalizedEmail!;
        if (await userManager.IsLockedOutAsync(account))
        {
            VerifyDummyPassword(password);
            return null;
        }

        cancellationToken.ThrowIfCancellationRequested();

        if (!await userManager.CheckPasswordAsync(account, password))
        {
            await RecordFailedAttemptAsync(
                account.Id,
                verifiedPublicId,
                verifiedPersonId,
                verifiedNormalizedEmail,
                account.PasswordHash!,
                account.SecurityStamp,
                cancellationToken);
            return null;
        }

        cancellationToken.ThrowIfCancellationRequested();
        var verifiedPasswordHash = account.PasswordHash;
        var verifiedSecurityStamp = account.SecurityStamp;
        if (verifiedPublicId == Guid.Empty ||
            string.IsNullOrWhiteSpace(verifiedPasswordHash) ||
            !await RecordSuccessfulAuthenticationAsync(
                account.Id,
                verifiedPublicId,
                verifiedPersonId,
                verifiedNormalizedEmail,
                verifiedPasswordHash,
                verifiedSecurityStamp,
                cancellationToken))
        {
            return null;
        }

        return new VerifiedCredential(verifiedPublicId);
    }

    private void VerifyDummyPassword(string password) =>
        _ = passwordHasher.VerifyHashedPassword(DummyAccount, DummyPasswordHash, password);

    private async Task RecordFailedAttemptAsync(
        long accountId,
        Guid verifiedPublicId,
        long verifiedPersonId,
        string verifiedNormalizedEmail,
        string verifiedPasswordHash,
        string? verifiedSecurityStamp,
        CancellationToken cancellationToken)
    {
        var lockout = identityOptions.Value.Lockout;
        var maximumAttempts = Math.Max(1, lockout.MaxFailedAccessAttempts);
        var now = timeProvider.GetUtcNow();
        var lockoutEnd = now.Add(lockout.DefaultLockoutTimeSpan);
        var concurrencyStamp = Guid.NewGuid().ToString("D");

        _ = await context.Users
            .Where(account =>
                account.Id == accountId &&
                account.PublicId == verifiedPublicId &&
                account.PersonId == verifiedPersonId &&
                account.NormalizedEmail == verifiedNormalizedEmail &&
                account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted &&
                account.EmailConfirmed &&
                account.LockoutEnabled &&
                !account.TwoFactorEnabled &&
                account.PasswordHash == verifiedPasswordHash &&
                account.SecurityStamp == verifiedSecurityStamp &&
                (account.LockoutEnd == null || account.LockoutEnd <= now))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(
                        account => account.AccessFailedCount,
                        account => account.AccessFailedCount + 1 >= maximumAttempts
                            ? 0
                            : account.AccessFailedCount + 1)
                    .SetProperty(
                        account => account.LockoutEnd,
                        account => account.AccessFailedCount + 1 >= maximumAttempts
                            ? lockoutEnd
                            : account.LockoutEnd)
                    .SetProperty(account => account.UpdatedAt, now)
                    .SetProperty(account => account.ConcurrencyStamp, concurrencyStamp),
                cancellationToken);
    }

    private async Task<bool> RecordSuccessfulAuthenticationAsync(
        long accountId,
        Guid verifiedPublicId,
        long verifiedPersonId,
        string verifiedNormalizedEmail,
        string verifiedPasswordHash,
        string? verifiedSecurityStamp,
        CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var concurrencyStamp = Guid.NewGuid().ToString("D");
        var rows = await context.Users
            .Where(account =>
                account.Id == accountId &&
                account.PublicId == verifiedPublicId &&
                account.PersonId == verifiedPersonId &&
                account.NormalizedEmail == verifiedNormalizedEmail &&
                account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted &&
                account.EmailConfirmed &&
                account.LockoutEnabled &&
                !account.TwoFactorEnabled &&
                account.PasswordHash == verifiedPasswordHash &&
                account.SecurityStamp == verifiedSecurityStamp &&
                (account.LockoutEnd == null || account.LockoutEnd <= now))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(account => account.AccessFailedCount, 0)
                    .SetProperty(account => account.LockoutEnd, (DateTimeOffset?)null)
                    .SetProperty(account => account.LastLoginAt, now)
                    .SetProperty(account => account.UpdatedAt, now)
                    .SetProperty(account => account.ConcurrencyStamp, concurrencyStamp),
                cancellationToken);

        return rows == 1;
    }
}
