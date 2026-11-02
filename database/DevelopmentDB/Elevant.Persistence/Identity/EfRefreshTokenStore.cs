using System.Security.Cryptography;
using System.Text;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Rotating refresh tokens (ADR-0021). A token lives while it is used at least every
/// <see cref="IdleLifetime"/>; each use replaces it. Presenting a replaced token again revokes the
/// whole family, except within <see cref="RotationGrace"/>, when two tabs of the same browser
/// refreshed at once and the slower one should just re-read the newer token.
/// </summary>
internal sealed class EfRefreshTokenStore(ElevantDbContext context, TimeProvider timeProvider) : IRefreshTokenStore
{
    public static readonly TimeSpan IdleLifetime = TimeSpan.FromDays(30);
    public static readonly TimeSpan RotationGrace = TimeSpan.FromSeconds(60);
    private const string Rotated = "rotated";

    public async Task<IssuedRefreshToken?> IssueAsync(Guid accountId, CancellationToken cancellationToken = default)
    {
        var account = await EligibleAccounts().Where(user => user.PublicId == accountId)
            .Select(user => new { user.Id, user.SecurityStamp }).SingleOrDefaultAsync(cancellationToken);
        if (account?.SecurityStamp is null) return null;
        var now = Now();
        var (value, row) = NewToken(account.Id, Guid.CreateVersion7(), Hash(account.SecurityStamp), now);
        context.Set<RefreshToken>().Add(row);
        await context.SaveChangesAsync(cancellationToken);
        context.Entry(row).State = EntityState.Detached;
        return new IssuedRefreshToken(value, now + IdleLifetime);
    }

    public async Task<RefreshTokenRotation> RotateAsync(string token, CancellationToken cancellationToken = default)
    {
        var now = Now();
        var hash = Hash(token);
        // Read without tracking: family revocations run as set-based updates, so a tracked copy
        // could be stale. The rotation itself is a compare-and-set on revoked_at below.
        var current = await context.Set<RefreshToken>().AsNoTracking()
            .SingleOrDefaultAsync(item => item.TokenHash == hash, cancellationToken);
        if (current is null) return Failed(RefreshTokenFailure.Invalid);
        if (current.RevokedAt is { } revokedAt)
        {
            if (current.RevokedReason == Rotated && now - revokedAt <= RotationGrace)
                return Failed(RefreshTokenFailure.AlreadyRotated);
            // A replaced token used again means it leaked: end the whole session.
            if (current.RevokedReason == Rotated) await RevokeFamilyAsync(current.FamilyId, "reuse", now, cancellationToken);
            return Failed(RefreshTokenFailure.Invalid);
        }
        if (now - current.LastUsedAt > IdleLifetime)
        {
            await RevokeFamilyAsync(current.FamilyId, "idle", now, cancellationToken);
            return Failed(RefreshTokenFailure.Invalid);
        }
        var account = await EligibleAccounts().Where(user => user.Id == current.AccountId)
            .Select(user => new { user.PublicId, user.SecurityStamp }).SingleOrDefaultAsync(cancellationToken);
        if (account?.SecurityStamp is null || Hash(account.SecurityStamp) != current.SecurityStampHash)
        {
            // Password changed, account disabled or access revoked by an administrator.
            await RevokeFamilyAsync(current.FamilyId, "stamp", now, cancellationToken);
            return Failed(RefreshTokenFailure.Invalid);
        }

        var (value, next) = NewToken(current.AccountId, current.FamilyId, current.SecurityStampHash, now);
        context.Set<RefreshToken>().Add(next);
        await context.SaveChangesAsync(cancellationToken);
        context.Entry(next).State = EntityState.Detached;
        var claimed = await context.Set<RefreshToken>()
            .Where(item => item.Id == current.Id && item.RevokedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.RevokedAt, now)
                .SetProperty(item => item.RevokedReason, Rotated)
                .SetProperty(item => item.ReplacedByTokenId, next.Id)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        if (claimed == 0)
        {
            // Another request rotated or revoked the same token first: drop ours and re-read.
            await context.Set<RefreshToken>().Where(item => item.Id == next.Id).ExecuteDeleteAsync(cancellationToken);
            return Failed(RefreshTokenFailure.AlreadyRotated);
        }
        return new RefreshTokenRotation(account.PublicId, new IssuedRefreshToken(value, now + IdleLifetime), null);
    }

    public async Task RevokeFamilyAsync(string token, CancellationToken cancellationToken = default)
    {
        var hash = Hash(token);
        var family = await context.Set<RefreshToken>().AsNoTracking().Where(item => item.TokenHash == hash)
            .Select(item => (Guid?)item.FamilyId).SingleOrDefaultAsync(cancellationToken);
        if (family is { } id) await RevokeFamilyAsync(id, "logout", Now(), cancellationToken);
    }

    private Task<int> RevokeFamilyAsync(Guid familyId, string reason, DateTimeOffset now, CancellationToken cancellationToken) =>
        context.Set<RefreshToken>().Where(item => item.FamilyId == familyId && item.RevokedAt == null)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.RevokedAt, now)
                .SetProperty(item => item.RevokedReason, reason).SetProperty(item => item.UpdatedAt, now), cancellationToken);

    // Same eligibility as a login (EfSessionSecurityVersionStore): an account that could not sign
    // in cannot keep its session alive either.
    private IQueryable<ApplicationUser> EligibleAccounts() =>
        context.Users.AsNoTracking().Where(account =>
            account.Status == AccountLifecycleStatus.Active &&
            account.InvitationStatus == InvitationStatus.Accepted &&
            account.EmailConfirmed && account.LockoutEnabled && !account.MustChangePassword &&
            !account.TwoFactorEnabled && account.PasswordHash != null);

    private static (string Value, RefreshToken Row) NewToken(long accountId, Guid familyId, string stampHash, DateTimeOffset now)
    {
        var value = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        return (value, new RefreshToken
        {
            PublicId = Guid.CreateVersion7(), AccountId = accountId, FamilyId = familyId, TokenHash = Hash(value),
            SecurityStampHash = stampHash, IssuedAt = now, LastUsedAt = now, CreatedAt = now, UpdatedAt = now,
        });
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private DateTimeOffset Now()
    {
        var now = timeProvider.GetUtcNow();
        return new DateTimeOffset(now.UtcTicks - now.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static RefreshTokenRotation Failed(RefreshTokenFailure failure) => new(null, null, failure);
}
