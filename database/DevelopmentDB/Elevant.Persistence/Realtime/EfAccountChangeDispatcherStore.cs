using System.Data;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Realtime;

/// <summary>Serializes feed projection in SQL; SignalR delivery happens only after commit.</summary>
internal sealed class EfAccountChangeDispatcherStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IAccountChangeDispatcherStore
{
    private const int MaxBatchSize = 100;
    private const int MaxMalformedAttempts = 3;

    public async Task<IReadOnlyList<AccountChangeDispatchNotice>> DispatchPendingAsync(
        int limit, CancellationToken cancellationToken = default)
    {
        if (limit is < 1 or > MaxBatchSize)
            throw new ArgumentOutOfRangeException(nameof(limit));

        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            context.ChangeTracker.Clear();
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted, cancellationToken);
            await context.Database.ExecuteSqlRawAsync(
                """
                DECLARE @lock_result int;
                EXEC @lock_result = sys.sp_getapplock
                    @Resource = N'ElevantAccountChangeDispatch',
                    @LockMode = N'Exclusive',
                    @LockOwner = N'Transaction',
                    @LockTimeout = 10000;
                IF @lock_result < 0
                    THROW 52501, 'Account change dispatch lock is unavailable.', 1;
                """, cancellationToken);

            var pending = await context.OutboxMessages
                .Where(message => message.EventType == "account.changed.v1" &&
                    message.ProcessedAt == null)
                .OrderBy(message => message.Id)
                .Take(limit)
                .ToArrayAsync(cancellationToken);
            var dispatched = new List<AccountChangeDispatchNotice>(pending.Length);

            foreach (var message in pending)
            {
                var now = timeProvider.GetUtcNow().ToUniversalTime();
                AccountChangeOutboxPayload payload;
                try
                {
                    payload = AccountChangeOutboxWriter.Decode(message);
                }
                catch (InvalidDataException)
                {
                    message.AttemptCount++;
                    message.LastError = "Invalid account change payload";
                    if (message.AttemptCount >= MaxMalformedAttempts)
                        message.ProcessedAt = now;
                    await context.SaveChangesAsync(cancellationToken);
                    continue;
                }

                var existing = await context.AccountChanges.AsNoTracking()
                    .SingleOrDefaultAsync(change =>
                        change.OutboxPublicId == message.PublicId &&
                        change.RecipientAccountId == payload.RecipientAccountId,
                        cancellationToken);
                if (existing is not null)
                {
                    message.ProcessedAt = now;
                    message.LastError = null;
                    await context.SaveChangesAsync(cancellationToken);
                    continue;
                }

                var accountPublicId = await context.Users.AsNoTracking()
                    .Where(account => account.Id == payload.RecipientAccountId)
                    .Select(account => (Guid?)account.PublicId)
                    .SingleOrDefaultAsync(cancellationToken);
                if (accountPublicId is null)
                {
                    message.AttemptCount++;
                    message.LastError = "Account change recipient no longer exists";
                    if (message.AttemptCount >= MaxMalformedAttempts)
                        message.ProcessedAt = now;
                    await context.SaveChangesAsync(cancellationToken);
                    continue;
                }

                var change = new AccountChange
                {
                    PublicId = Guid.CreateVersion7(),
                    OutboxPublicId = message.PublicId,
                    RecipientAccountId = payload.RecipientAccountId,
                    StationId = payload.StationId,
                    Resource = payload.Resource,
                    ResourceId = payload.ResourceId,
                    OccurredAt = message.OccurredAt,
                    CreatedAt = now,
                };
                context.AccountChanges.Add(change);
                message.ProcessedAt = now;
                message.AttemptCount++;
                message.LastError = null;
                // Saving one row at a time makes identity allocation follow this serial batch order.
                await context.SaveChangesAsync(cancellationToken);
                dispatched.Add(new AccountChangeDispatchNotice(
                    accountPublicId.Value, message.PublicId, change.PublicId,
                    change.Resource, change.Id));
            }

            await transaction.CommitAsync(cancellationToken);
            return (IReadOnlyList<AccountChangeDispatchNotice>)dispatched;
        });
    }
}
