using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

internal sealed class EfSessionSecurityVersionStore(ElevantDbContext context)
    : ISessionSecurityVersionStore
{
    public async Task<string?> GetCurrentAsync(
        Guid accountId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
        {
            return null;
        }

        return await context.Users.AsNoTracking()
            .Where(account =>
                account.PublicId == accountId &&
                account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted &&
                account.EmailConfirmed &&
                account.LockoutEnabled &&
                !account.MustChangePassword &&
                !account.TwoFactorEnabled &&
                account.PasswordHash != null)
            .Select(account => account.SecurityStamp)
            .SingleOrDefaultAsync(cancellationToken);
    }
}
