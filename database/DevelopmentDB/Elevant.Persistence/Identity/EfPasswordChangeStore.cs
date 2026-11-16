using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Identity;

internal sealed class EfPasswordChangeStore(
    ElevantDbContext context,
    UserManager<ApplicationUser> userManager,
    TimeProvider timeProvider) : IPasswordChangeStore
{
    public async Task<PasswordChangeOutcome> ChangeAsync(
        Guid accountId,
        string currentPassword,
        string newPassword,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || string.IsNullOrWhiteSpace(currentPassword) ||
            string.IsNullOrWhiteSpace(newPassword))
        {
            return PasswordChangeOutcome.InvalidCredentials;
        }

        var strategy = context.Database.CreateExecutionStrategy();
        Guid? auditId = null;
        return await strategy.ExecuteInTransactionAsync<PasswordChangeOutcome>(
            async operationCancellationToken =>
            {
                context.ChangeTracker.Clear();
                auditId = null;
                var account = await context.Users.SingleOrDefaultAsync(
                    user => user.PublicId == accountId &&
                        user.Status == AccountLifecycleStatus.Active &&
                        user.InvitationStatus == InvitationStatus.Accepted &&
                        user.EmailConfirmed &&
                        user.LockoutEnabled &&
                        !user.TwoFactorEnabled,
                    operationCancellationToken);
                if (account is null || !await userManager.CheckPasswordAsync(account, currentPassword))
                {
                    return PasswordChangeOutcome.InvalidCredentials;
                }

                account.MustChangePassword = false;
                account.UpdatedAt = timeProvider.GetUtcNow();
                var changed = await userManager.ChangePasswordAsync(account, currentPassword, newPassword);
                if (!changed.Succeeded)
                {
                    return changed.Errors.Any(error => error.Code.StartsWith("Password", StringComparison.Ordinal))
                        ? PasswordChangeOutcome.RejectedNewPassword
                        : PasswordChangeOutcome.InvalidCredentials;
                }

                auditId = Guid.NewGuid();
                context.AuditEntries.Add(new AuditEntry
                {
                    PublicId = auditId.Value,
                    OccurredAt = timeProvider.GetUtcNow(),
                    ActorType = AuditActorType.Account,
                    ActorAccountId = account.Id,
                    Action = "identity.password.changed",
                    EntityType = "iam.accounts",
                    EntityPublicId = account.PublicId,
                    Source = AuditSource.Api,
                    CorrelationId = Guid.NewGuid(),
                });
                await context.SaveChangesAsync(operationCancellationToken);
                return PasswordChangeOutcome.Succeeded;
            },
            async verificationCancellationToken =>
            {
                context.ChangeTracker.Clear();
                return auditId is not Guid committedAuditId ||
                    await context.AuditEntries.AsNoTracking().AnyAsync(
                        entry => entry.PublicId == committedAuditId &&
                            entry.ActorType == AuditActorType.Account &&
                            entry.ActorAccountId != null &&
                            entry.EntityPublicId == accountId &&
                            entry.Action == "identity.password.changed",
                        verificationCancellationToken);
            },
            IsolationLevel.Serializable,
            cancellationToken);
    }
}
