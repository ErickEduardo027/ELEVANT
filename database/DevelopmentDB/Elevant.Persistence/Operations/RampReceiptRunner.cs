using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>What a mobile command touched, or why it was refused, plus its device receipt.</summary>
internal sealed record RampReceiptOutcome(long OperationId, Guid OperationPublicId, RampExecutionWriteFailure? Failure,
    Guid? ReceiptId)
{
    public bool IsSuccess => Failure is null;

    public static RampReceiptOutcome Failed(RampExecutionWriteFailure failure, Guid? receiptId = null) =>
        new(0, Guid.Empty, failure, receiptId);
}

/// <summary>The scope a mobile command runs in: the agent, its device, the locked operation and the receipt.</summary>
internal sealed record RampReceiptScope(RampExecutionActorAccess Actor, RampOperationExecutionScope Operation,
    MobileCommandReceipt Receipt, DateTimeOffset Now);

/// <summary>
/// The contract every tablet command follows (ADR-0031/0032/0033): a device-scoped idempotency
/// receipt, the assigned agent only, a serializable transaction, audit and the ramp change hint.
/// The same key with the same body replays; the same key with another body is refused. Callers read
/// their own view after the commit, so a replay always returns the current state.
/// </summary>
internal sealed class RampReceiptRunner(ElevantDbContext context, TimeProvider timeProvider)
{
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<RampReceiptOutcome> RunAsync(string commandType, Guid accountId, IReadOnlyCollection<Guid> stations,
        Guid operationId, Guid installationId, Guid idempotencyKey, string payloadHash,
        Func<RampReceiptScope, CancellationToken, Task<bool>> apply, CancellationToken cancellationToken)
    {
        RampReceiptOutcome? attempt = null;
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                async ct =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await InsideAsync(commandType, accountId, stations, operationId, installationId,
                        idempotencyKey, payloadHash, apply, ct);
                    if (attempt.ReceiptId is null) context.ChangeTracker.Clear();
                    return attempt;
                },
                async ct =>
                {
                    context.ChangeTracker.Clear();
                    return attempt?.ReceiptId is not Guid receiptId
                        ? attempt is not null
                        : await context.MobileCommandReceipts.AsNoTracking().AnyAsync(item => item.PublicId == receiptId, ct);
                },
                IsolationLevel.Serializable, cancellationToken);
        }
        catch (Exception exception) when (exception is DbUpdateConcurrencyException ||
            (exception is RetryLimitExceededException or DbUpdateException or SqlException &&
             exception.GetBaseException() is SqlException { Number: 1205 or 1222 or 3960 or 2601 or 2627 or 547 }))
        {
            context.ChangeTracker.Clear();
            return RampReceiptOutcome.Failed(RampExecutionWriteFailure.Conflict);
        }
    }

    public void Audit(RampReceiptScope scope, string? requestId, string action, string reason, object metadata) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = scope.Now, ActorType = AuditActorType.Account,
            ActorAccountId = scope.Actor.AccountInternalId, ActorDisplay = scope.Actor.DisplayName, Action = action,
            EntityType = nameof(GroundOperation), EntityPublicId = scope.Operation.Operation.PublicId,
            OrganizationId = scope.Operation.AirlineOrganizationInternalId, StationId = scope.Operation.StationInternalId,
            Source = AuditSource.MobileSync, CorrelationId = Guid.CreateVersion7(), RequestId = requestId,
            Reason = reason, MetadataJson = JsonSerializer.Serialize(metadata, Json),
        });

    public static string Hash(object canonical) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(canonical, Json))));

    public static DateTimeOffset Truncate(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private async Task<RampReceiptOutcome> InsideAsync(string commandType, Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid operationId, Guid installationId, Guid idempotencyKey, string payloadHash,
        Func<RampReceiptScope, CancellationToken, Task<bool>> apply, CancellationToken cancellationToken)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actorResult = await authorization.ResolveActorAsync(accountId, stations, installationId, cancellationToken);
        if (!actorResult.IsSuccess)
            return RampReceiptOutcome.Failed(actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                ? RampExecutionWriteFailure.Forbidden : RampExecutionWriteFailure.NotFound);
        var actor = actorResult.Access!;
        var device = actor.Device!;
        var now = Truncate(timeProvider.GetUtcNow());
        var key = idempotencyKey.ToString("D");
        var existing = await context.MobileCommandReceipts.FromSqlInterpolated($"""
                SELECT * FROM [integration].[mobile_command_receipts] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id} AND [idempotency_key] = {key}
                """).SingleOrDefaultAsync(cancellationToken);
        if (existing is not null) return await ReplayAsync(existing, commandType, actor.AccountInternalId, payloadHash,
            cancellationToken);

        var receipt = new MobileCommandReceipt
        {
            PublicId = Guid.CreateVersion7(), MobileDeviceId = device.Id, AccountId = actor.AccountInternalId,
            IdempotencyKey = key, CommandType = commandType, PayloadHash = payloadHash, Status = MobileCommandStatus.Received,
            ReceivedAt = now, ExpiresAt = now.Add(ReceiptRetention), CreatedAt = now, UpdatedAt = now,
        };
        context.MobileCommandReceipts.Add(receipt);
        var operation = await authorization.ResolveOperationAsync(actor, operationId, lockForUpdate: true, cancellationToken);
        if (operation is null) return await RejectAsync(receipt, "not_found", now, cancellationToken);

        var scope = new RampReceiptScope(actor, operation, receipt, now);
        if (!await apply(scope, cancellationToken)) return await RejectAsync(receipt, "conflict", now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Operation.Id, now, false, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        // The view is re-read on replay instead of stored: the operation keeps changing after the write.
        receipt.ResultJson = JsonSerializer.Serialize(new { operationId = operation.Operation.PublicId }, Json);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return new RampReceiptOutcome(operation.Operation.Id, operation.Operation.PublicId, null, receipt.PublicId);
    }

    private async Task<RampReceiptOutcome> RejectAsync(MobileCommandReceipt receipt, string errorCode,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        context.ChangeTracker.Entries().Where(entry => entry.Entity != receipt && entry.State != EntityState.Unchanged)
            .ToList().ForEach(entry => entry.State = entry.State == EntityState.Added ? EntityState.Detached : EntityState.Unchanged);
        receipt.Status = MobileCommandStatus.Rejected;
        receipt.ProcessedAt = now;
        receipt.ErrorCode = errorCode;
        receipt.ErrorMessage = errorCode == "not_found"
            ? "The ramp operation was not found." : "The entry conflicts with the operation's current state.";
        receipt.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampReceiptOutcome.Failed(errorCode == "not_found"
            ? RampExecutionWriteFailure.NotFound : RampExecutionWriteFailure.Conflict, receipt.PublicId);
    }

    private async Task<RampReceiptOutcome> ReplayAsync(MobileCommandReceipt receipt, string commandType, long accountId,
        string payloadHash, CancellationToken cancellationToken)
    {
        if (receipt.AccountId != accountId || receipt.CommandType != commandType || receipt.PayloadHash != payloadHash)
            return RampReceiptOutcome.Failed(RampExecutionWriteFailure.IdempotencyKeyConflict);
        if (receipt.Status == MobileCommandStatus.Rejected)
            return RampReceiptOutcome.Failed(receipt.ErrorCode == "not_found"
                ? RampExecutionWriteFailure.NotFound : RampExecutionWriteFailure.Conflict, receipt.PublicId);
        if (receipt.Status != MobileCommandStatus.Processed || string.IsNullOrWhiteSpace(receipt.ResultJson))
            return RampReceiptOutcome.Failed(RampExecutionWriteFailure.Conflict);
        var operationPublicId = JsonDocument.Parse(receipt.ResultJson).RootElement.GetProperty("operationId").GetGuid();
        var operationId = await context.GroundOperations.AsNoTracking().Where(item => item.PublicId == operationPublicId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        return new RampReceiptOutcome(operationId, operationPublicId, null, receipt.PublicId);
    }
}
