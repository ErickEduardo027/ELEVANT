using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
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

/// <summary>Starts a new editable round after a reasoned OCC return, without editing the old handoff.</summary>
internal sealed class EfRampOperationCorrectionStore(
    ElevantDbContext context, TimeProvider timeProvider) : IRampOperationCorrectionStore
{
    private const string CommandType = "ramp.operation.correction.reopen.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<RampOperationCorrectionWriteResult> ReopenAsync(
        RampOperationCorrectionWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        RampOperationCorrectionWriteResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await ReopenInsideTransactionAsync(request, token);
                    if (attempt.CommitReceiptId is null) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    return attempt?.CommitReceiptId is not Guid receiptId ||
                        await context.MobileCommandReceipts.AsNoTracking()
                            .AnyAsync(item => item.PublicId == receiptId, token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Conflict();
        }
        catch (RetryLimitExceededException exception) when (IsSerializationConflict(exception))
        {
            context.ChangeTracker.Clear();
            return Conflict();
        }
        catch (DbUpdateException exception) when (IsOperationalConflict(exception))
        {
            context.ChangeTracker.Clear();
            return Conflict();
        }
        catch (SqlException exception) when (IsSerializationConflict(exception.Number))
        {
            context.ChangeTracker.Clear();
            return Conflict();
        }
    }

    private async Task<RampOperationCorrectionWriteResult> ReopenInsideTransactionAsync(
        RampOperationCorrectionWriteRequest request, CancellationToken cancellationToken)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actorResult = await authorization.ResolveActorAsync(
            request.ActorAccountId, request.AllowedStationIds, request.InstallationId,
            cancellationToken);
        if (!actorResult.IsSuccess)
            return RampOperationCorrectionWriteResult.Failed(
                actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                    ? RampOperationsFailure.Forbidden : RampOperationsFailure.NotFound);

        var actor = actorResult.Access!;
        var device = actor.Device!;
        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var key = request.IdempotencyKey.ToString("D");
        var payloadHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{CommandType}|{request.OperationId:D}"))).ToLowerInvariant();
        var existingReceipt = await context.MobileCommandReceipts
            .FromSqlInterpolated($"""
                SELECT * FROM [integration].[mobile_command_receipts] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id} AND [idempotency_key] = {key}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (existingReceipt is not null)
            return Replay(existingReceipt, actor.AccountInternalId, payloadHash);

        var receipt = new MobileCommandReceipt
        {
            PublicId = Guid.CreateVersion7(),
            MobileDeviceId = device.Id,
            AccountId = actor.AccountInternalId,
            IdempotencyKey = key,
            CommandType = CommandType,
            PayloadHash = payloadHash,
            Status = MobileCommandStatus.Received,
            ReceivedAt = now,
            ExpiresAt = now.Add(ReceiptRetention),
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.MobileCommandReceipts.Add(receipt);

        var scope = await authorization.ResolveOperationAsync(
            actor, request.OperationId, true, cancellationToken);
        if (scope is null)
            return await RejectAsync(receipt, RampOperationsFailure.NotFound,
                "not_found", now, cancellationToken);

        var submissions = await context.OperationSubmissions
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_submissions] WITH (UPDLOCK, HOLDLOCK)
                WHERE [ground_operation_id] = {scope.Operation.Id}
                """)
            .ToArrayAsync(cancellationToken);
        var previous = submissions.MaxBy(item => item.RevisionNumber);
        if (scope.Operation.CurrentStatus != GroundOperationStatus.Returned ||
            scope.Operation.ActualStartAt is null || scope.Operation.ActualEndAt is null ||
            scope.TurnaroundStatus is not (TurnaroundStatus.Confirmed or TurnaroundStatus.InProgress) ||
            previous is not { Status: SubmissionStatus.Returned })
            return await RejectAsync(receipt, RampOperationsFailure.Conflict,
                "conflict", now, cancellationToken);

        var decision = await context.ReviewDecisions.AsNoTracking()
            .SingleOrDefaultAsync(item => item.OperationSubmissionId == previous.Id,
                cancellationToken);
        if (decision is not { Outcome: ReviewOutcome.Returned } ||
            string.IsNullOrWhiteSpace(decision.Reason))
            return await RejectAsync(receipt, RampOperationsFailure.Conflict,
                "conflict", now, cancellationToken);

        var oldChecklist = await context.OperationChecklists.AsNoTracking()
            .SingleAsync(item => item.Id == previous.OperationChecklistId, cancellationToken);
        var revision = checked(previous.RevisionNumber + 1);
        if (oldChecklist.Status != ChecklistStatus.Submitted ||
            oldChecklist.RevisionNumber != previous.RevisionNumber ||
            await context.OperationChecklists.AsNoTracking().AnyAsync(item =>
                item.GroundOperationId == scope.Operation.Id &&
                item.ChecklistTemplateVersionId == oldChecklist.ChecklistTemplateVersionId &&
                item.RevisionNumber == revision, cancellationToken))
            return await RejectAsync(receipt, RampOperationsFailure.Conflict,
                "conflict", now, cancellationToken);

        // Releases created before evidence snapshots are upgraded at the last frozen moment.
        if (previous.EvidenceJson is null)
        {
            previous.EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(
                context, scope.Operation.Id, cancellationToken)).ToJson();
            previous.UpdatedAt = now;
        }

        var checklist = new OperationChecklist
        {
            PublicId = request.IdempotencyKey,
            GroundOperationId = scope.Operation.Id,
            ChecklistTemplateVersionId = oldChecklist.ChecklistTemplateVersionId,
            RevisionNumber = revision,
            Status = ChecklistStatus.NotStarted,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.OperationChecklists.Add(checklist);
        scope.Operation.CurrentStatus = GroundOperationStatus.InProgress;
        scope.Operation.ActualEndAt = null;
        scope.Operation.UpdatedAt = now;
        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = scope.Operation.Id,
            FromStatus = GroundOperationStatus.Returned,
            ToStatus = GroundOperationStatus.InProgress,
            OccurredAt = now,
            ActorAccountId = actor.AccountInternalId,
            Reason = "Assigned ramp agent opened a new correction revision after OCC return.",
        });
        var audit = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId,
            ActorDisplay = actor.DisplayName,
            Action = "ramp.operation.correction.started",
            EntityType = nameof(OperationChecklist),
            EntityPublicId = checklist.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Assigned ramp agent opened a new revision without changing submitted evidence.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = scope.Operation.PublicId,
                previousSubmissionId = previous.PublicId,
                revision,
                installationId = device.InstallationId,
            }, JsonOptions),
        };
        context.AuditEntries.Add(audit);

        await RampOperationChangeWriter.AnnounceAsync(context, scope.Operation.Id, now, true, cancellationToken);
        var result = new RampOperationCorrectionData(
            receipt.PublicId, scope.Operation.PublicId, previous.PublicId,
            checklist.PublicId, revision, GroundOperationStatus.InProgress.ToString(),
            decision.Reason);
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(result, JsonOptions);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        context.AuditChanges.AddRange(
            new AuditChange
            {
                AuditEntryId = audit.Id,
                PropertyName = nameof(GroundOperation.CurrentStatus),
                OldValue = GroundOperationStatus.Returned.ToString(),
                NewValue = GroundOperationStatus.InProgress.ToString(),
            },
            new AuditChange
            {
                AuditEntryId = audit.Id,
                PropertyName = nameof(GroundOperation.ActualEndAt),
                OldValue = previous.SubmittedAt.ToString("O"),
                NewValue = null,
            });
        await context.SaveChangesAsync(cancellationToken);
        return RampOperationCorrectionWriteResult.Success(result, receipt.PublicId);
    }

    private async Task<RampOperationCorrectionWriteResult> RejectAsync(
        MobileCommandReceipt receipt, RampOperationsFailure failure,
        string code, DateTimeOffset now, CancellationToken cancellationToken)
    {
        receipt.Status = MobileCommandStatus.Rejected;
        receipt.ProcessedAt = now;
        receipt.ErrorCode = code;
        receipt.ErrorMessage = "The returned operation cannot start a correction revision.";
        receipt.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampOperationCorrectionWriteResult.Failed(failure, receipt.PublicId);
    }

    private static RampOperationCorrectionWriteResult Replay(
        MobileCommandReceipt receipt, long actorAccountId, string payloadHash)
    {
        if (receipt.AccountId != actorAccountId || receipt.CommandType != CommandType ||
            receipt.PayloadHash != payloadHash)
            return Conflict();
        if (receipt.Status == MobileCommandStatus.Processed &&
            !string.IsNullOrWhiteSpace(receipt.ResultJson))
        {
            var result = JsonSerializer.Deserialize<RampOperationCorrectionData>(
                receipt.ResultJson, JsonOptions)
                ?? throw new InvalidOperationException("The stored correction receipt is invalid.");
            if (result.ReceiptId != receipt.PublicId)
                throw new InvalidOperationException("The stored correction receipt ID is invalid.");
            return RampOperationCorrectionWriteResult.Success(result, receipt.PublicId);
        }
        if (receipt.Status == MobileCommandStatus.Rejected)
            return RampOperationCorrectionWriteResult.Failed(
                receipt.ErrorCode == "not_found"
                    ? RampOperationsFailure.NotFound : RampOperationsFailure.Conflict,
                receipt.PublicId);
        return Conflict();
    }

    private static DateTimeOffset NormalizeToMilliseconds(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(
            utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static RampOperationCorrectionWriteResult Conflict() =>
        RampOperationCorrectionWriteResult.Failed(RampOperationsFailure.Conflict);

    private static bool IsOperationalConflict(DbUpdateException exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        (sqlException.Number is 2601 or 2627 or 547 || IsSerializationConflict(sqlException.Number));

    private static bool IsSerializationConflict(int number) => number is 1205 or 1222 or 3960;

    private static bool IsSerializationConflict(Exception exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        IsSerializationConflict(sqlException.Number);
}
