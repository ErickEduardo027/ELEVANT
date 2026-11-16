using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Commercial;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>
/// The command pattern of the master-data stores (2-A): the Idempotency-Key receipt, the work, the receipt and
/// the commit in one serializable transaction (<see cref="CommercialCommandReceipts"/>). A replay answers the
/// record the first attempt wrote and never repeats its audit or announcements; any other use of the key is
/// <c>idempotency_conflict</c>; a stale rowversion is <c>version_conflict</c>.
/// </summary>
internal static class MasterDataCommand
{
    /// <summary>
    /// What a command step produced: the record it wrote, or the failure that rolls it back with the rules it
    /// breaks and, for a taken unique value, the record that already holds it.
    /// </summary>
    internal readonly record struct Step(Guid ResultId, MasterDataFailure? Failure, string? Code,
        IReadOnlyList<string>? Reasons = null, Guid? ExistingId = null)
    {
        public static Step Done(Guid resultId) => new(resultId, null, null);

        public static Step Fail(MasterDataFailure failure, string code) => new(Guid.Empty, failure, code);

        public static Step Fail(MasterDataFailure failure, string code, IReadOnlyList<string>? reasons,
            Guid? existingId = null) => new(Guid.Empty, failure, code, reasons, existingId);
    }

    /// <summary>
    /// Runs one command; <c>duplicateCode</c> is the code of a unique index a concurrent command filled first.
    /// </summary>
    public static async Task<MasterDataResult<T>> RunAsync<T>(ElevantDbContext context, Guid key, long accountId, string action,
        string hash, string duplicateCode, DateTimeOffset now, Func<Task<Step>> work, Func<Guid, Task<T?>> answer,
        CancellationToken cancellationToken) where T : class
    {
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            var (step, replayed) = await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                    return (Step.Fail(MasterDataFailure.Conflict, "idempotency_conflict"), false);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return (Step.Done(prior.ResultId), true);
                var done = await work();
                if (done.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return (done, false);
                }
                CommercialCommandReceipts.Add(context, key, accountId, action, hash, done.ResultId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return (done, false);
            });
            context.ChangeTracker.Clear();
            return step.Failure is { } failure
                ? MasterDataResult<T>.Failed(failure, step.Code!, step.Reasons, step.ExistingId)
                : await AnswerAsync(answer, step.ResultId, replayed);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return MasterDataResult<T>.Failed(MasterDataFailure.Conflict, "version_conflict");
        }
        catch (RetryLimitExceededException exception) when (exception.GetBaseException() is SqlException { Number: 1205 or 3960 })
        {
            // A deadlock or snapshot conflict that kept repeating: the caller re-reads and decides again.
            context.ChangeTracker.Clear();
            return MasterDataResult<T>.Failed(MasterDataFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await AnswerAsync(answer, concurrent.ResultId, true)
                : MasterDataResult<T>.Failed(MasterDataFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            return MasterDataResult<T>.Failed(MasterDataFailure.Conflict, duplicateCode);
        }
    }

    /// <summary>The rowversion as the expected version clients send back.</summary>
    public static string Version(byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    /// <summary>
    /// Audits a master-data change with the fields it changed (<see cref="AuditFieldChangeData"/>); nothing is
    /// ever deleted, so a deactivation is one of these changes.
    /// </summary>
    public static void Audit(ElevantDbContext context, long accountId, string action, string entityType, Guid entityId,
        long? stationId, DateTimeOffset now, params AuditFieldChangeData[] changes)
    {
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = accountId,
            Action = action, EntityType = entityType, EntityPublicId = entityId, StationId = stationId,
            Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            MetadataJson = SafeAuditChanges.Serialize(changes),
        });
    }

    /// <summary>Created, deactivated, reactivated or updated, from the active flag before and after.</summary>
    public static string Event(string prefix, bool wasActive, bool isActive) =>
        wasActive == isActive ? $"{prefix}.updated" : isActive ? $"{prefix}.reactivated" : $"{prefix}.deactivated";

    private static async Task<MasterDataResult<T>> AnswerAsync<T>(Func<Guid, Task<T?>> answer, Guid id, bool replayed)
        where T : class =>
        await answer(id) is { } value
            ? MasterDataResult<T>.Success(value, replayed)
            : MasterDataResult<T>.Failed(MasterDataFailure.NotFound, "not_found");
}
