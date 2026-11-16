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

/// <summary>Atomically submits one immutable ramp checklist.</summary>
internal sealed class EfRampOperationChecklistCommandStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IRampOperationChecklistCommandStore
{
    private const string CommandType = "ramp.operation.checklist.submit.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions ReceiptJsonOptions =
        new(JsonSerializerDefaults.Web);

    public async Task<RampChecklistSubmissionWriteResult> SubmitChecklistAsync(
        RampChecklistSubmissionWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var strategy = context.Database.CreateExecutionStrategy();
        RampChecklistSubmissionWriteResult? attemptResult = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async operationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    attemptResult = await SubmitInsideTransactionAsync(
                        request,
                        operationCancellationToken);
                    if (attemptResult.CommitReceiptId is null)
                    {
                        context.ChangeTracker.Clear();
                    }

                    return attemptResult;
                },
                async verificationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    if (attemptResult?.CommitReceiptId is not Guid receiptId)
                    {
                        return attemptResult is not null;
                    }

                    return await context.MobileCommandReceipts
                        .AsNoTracking()
                        .AnyAsync(
                            receipt => receipt.PublicId == receiptId,
                            verificationCancellationToken);
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

    private async Task<RampChecklistSubmissionWriteResult> SubmitInsideTransactionAsync(
        RampChecklistSubmissionWriteRequest request,
        CancellationToken cancellationToken)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actorResult = await authorization.ResolveActorAsync(
            request.ActorAccountId,
            request.AllowedStationIds,
            request.InstallationId,
            cancellationToken);
        if (!actorResult.IsSuccess)
        {
            return actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                ? Forbidden()
                : NotFound();
        }

        var actor = actorResult.Access!;
        var device = actor.Device!;
        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var idempotencyKey = request.IdempotencyKey.ToString("D");
        var payloadHash = ComputePayloadHash(request);
        var existingReceipt = await context.MobileCommandReceipts
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_command_receipts] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id}
                  AND [idempotency_key] = {idempotencyKey}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (existingReceipt is not null)
        {
            return Replay(existingReceipt, actor.AccountInternalId, payloadHash);
        }

        var receipt = NewReceipt(
            device.Id,
            actor.AccountInternalId,
            idempotencyKey,
            payloadHash,
            now);
        context.MobileCommandReceipts.Add(receipt);

        var scope = await authorization.ResolveOperationAsync(
            actor,
            request.OperationId,
            lockForUpdate: true,
            cancellationToken);
        if (scope is null)
        {
            return await RejectAsync(
                receipt,
                RampChecklistSubmissionWriteFailure.NotFound,
                "not_found",
                "The ramp operation or checklist was not found.",
                now,
                cancellationToken);
        }

        if (!RampOperationExecutionPolicy.CanExecute(
                scope.TurnaroundStatus,
                scope.Operation.CurrentStatus,
                scope.Operation.ActualStartAt,
                scope.Operation.ActualEndAt))
        {
            return await RejectAsync(
                receipt,
                RampChecklistSubmissionWriteFailure.Conflict,
                "conflict",
                "The ramp checklist cannot be submitted in the current operation state.",
                now,
                cancellationToken);
        }

        var checklist = await context.OperationChecklists
            .FromSqlInterpolated($"""
                SELECT *
                FROM [ops].[operation_checklists] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.ChecklistId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (checklist is null || checklist.GroundOperationId != scope.Operation.Id)
        {
            return await RejectAsync(
                receipt,
                RampChecklistSubmissionWriteFailure.NotFound,
                "not_found",
                "The ramp operation or checklist was not found.",
                now,
                cancellationToken);
        }

        var canonicalChecklistId = await (
                from operationChecklist in context.OperationChecklists.AsNoTracking()
                join version in context.Set<ChecklistTemplateVersion>().AsNoTracking()
                    on operationChecklist.ChecklistTemplateVersionId equals version.Id
                join template in context.Set<ChecklistTemplate>().AsNoTracking()
                    on version.ChecklistTemplateId equals template.Id
                where operationChecklist.GroundOperationId == scope.Operation.Id &&
                      RampChecklists.Execution.Contains(template.Code)
                orderby operationChecklist.RevisionNumber descending,
                    version.VersionNumber descending
                select (Guid?)operationChecklist.PublicId)
            .FirstOrDefaultAsync(cancellationToken);
        if (canonicalChecklistId != checklist.PublicId)
        {
            return await RejectAsync(
                receipt,
                RampChecklistSubmissionWriteFailure.Conflict,
                "conflict",
                "The ramp checklist is not the applicable published checklist.",
                now,
                cancellationToken);
        }

        var itemRules = await context.Set<ChecklistTemplateItem>()
            .AsNoTracking()
            .Where(item => item.ChecklistTemplateVersionId == checklist.ChecklistTemplateVersionId)
            .OrderBy(item => item.SortOrder)
            .Select(item => new RampChecklistItemRule(
                item.PublicId,
                item.IsRequired,
                item.RequiresNoteWhenNotOk))
            .ToArrayAsync(cancellationToken);
        var hasExistingAnswers = await context.Set<ChecklistAnswer>()
            .AsNoTracking()
            .AnyAsync(
                answer => answer.OperationChecklistId == checklist.Id,
                cancellationToken);
        if (hasExistingAnswers ||
            !RampChecklistSubmissionPolicy.CanSubmit(
                checklist.Status,
                itemRules,
                request.Answers))
        {
            return await RejectAsync(
                receipt,
                RampChecklistSubmissionWriteFailure.Conflict,
                "conflict",
                "The ramp checklist submission conflicts with canonical checklist data.",
                now,
                cancellationToken);
        }

        var itemsByPublicId = await context.Set<ChecklistTemplateItem>()
            .AsNoTracking()
            .Where(item => item.ChecklistTemplateVersionId == checklist.ChecklistTemplateVersionId)
            .ToDictionaryAsync(item => item.PublicId, item => item.Id, cancellationToken);
        context.Set<ChecklistAnswer>().AddRange(request.Answers.Select(answer =>
            new ChecklistAnswer
            {
                PublicId = Guid.CreateVersion7(),
                OperationChecklistId = checklist.Id,
                ChecklistTemplateItemId = itemsByPublicId[answer.ItemId],
                Value = answer.Value,
                Note = string.IsNullOrWhiteSpace(answer.Note) ? null : answer.Note.Trim(),
                AnsweredAt = now,
                RampAgentId = actor.RampAgentInternalId,
                CreatedAt = now,
                UpdatedAt = now,
            }));

        var previousStatus = checklist.Status;
        checklist.Status = ChecklistStatus.Submitted;
        checklist.StartedAt ??= now;
        checklist.SubmittedAt = now;
        checklist.SubmittedByRampAgentId = actor.RampAgentInternalId;
        checklist.UpdatedAt = now;

        var auditEntry = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId,
            ActorDisplay = actor.DisplayName,
            Action = "ramp.operation.checklist.submitted",
            EntityType = nameof(OperationChecklist),
            EntityPublicId = checklist.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Assigned ramp agent submitted the operation checklist.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = scope.Operation.PublicId,
                turnaroundId = scope.TurnaroundPublicId,
                rampAgentId = actor.RampAgentPublicId,
                answerCount = request.Answers.Count,
                installationId = device.InstallationId,
            }, ReceiptJsonOptions),
        };
        context.AuditEntries.Add(auditEntry);

        await RampOperationChangeWriter.AnnounceAsync(context, checklist.GroundOperationId, now, false, cancellationToken);
        var submission = new RampChecklistSubmissionData(
            receipt.PublicId,
            new RampChecklistSubmissionSummaryData(
                checklist.PublicId,
                checklist.Status.ToString(),
                checklist.StartedAt.Value,
                checklist.SubmittedAt.Value,
                request.Answers.Count));
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(submission, ReceiptJsonOptions);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;

        await context.SaveChangesAsync(cancellationToken);
        context.AuditChanges.AddRange(
            new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = nameof(OperationChecklist.Status),
                OldValue = previousStatus.ToString(),
                NewValue = ChecklistStatus.Submitted.ToString(),
            },
            new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = "AnswerCount",
                OldValue = "0",
                NewValue = request.Answers.Count.ToString(
                    System.Globalization.CultureInfo.InvariantCulture),
            });
        await context.SaveChangesAsync(cancellationToken);

        return RampChecklistSubmissionWriteResult.Success(submission, receipt.PublicId);
    }

    private static MobileCommandReceipt NewReceipt(
        long deviceId,
        long accountId,
        string idempotencyKey,
        string payloadHash,
        DateTimeOffset now) => new()
        {
            PublicId = Guid.CreateVersion7(),
            MobileDeviceId = deviceId,
            AccountId = accountId,
            IdempotencyKey = idempotencyKey,
            CommandType = CommandType,
            PayloadHash = payloadHash,
            Status = MobileCommandStatus.Received,
            ReceivedAt = now,
            ExpiresAt = now.Add(ReceiptRetention),
            CreatedAt = now,
            UpdatedAt = now,
        };

    private async Task<RampChecklistSubmissionWriteResult> RejectAsync(
        MobileCommandReceipt receipt,
        RampChecklistSubmissionWriteFailure failure,
        string errorCode,
        string errorMessage,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        receipt.Status = MobileCommandStatus.Rejected;
        receipt.ProcessedAt = now;
        receipt.ErrorCode = errorCode;
        receipt.ErrorMessage = errorMessage;
        receipt.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampChecklistSubmissionWriteResult.Failed(failure, receipt.PublicId);
    }

    private static RampChecklistSubmissionWriteResult Replay(
        MobileCommandReceipt receipt,
        long actorAccountId,
        string payloadHash)
    {
        if (receipt.AccountId != actorAccountId ||
            !string.Equals(receipt.CommandType, CommandType, StringComparison.Ordinal) ||
            !string.Equals(receipt.PayloadHash, payloadHash, StringComparison.Ordinal))
        {
            return RampChecklistSubmissionWriteResult.Failed(
                RampChecklistSubmissionWriteFailure.IdempotencyKeyConflict);
        }

        if (receipt.Status == MobileCommandStatus.Processed &&
            !string.IsNullOrWhiteSpace(receipt.ResultJson))
        {
            var result = JsonSerializer.Deserialize<RampChecklistSubmissionData>(
                receipt.ResultJson,
                ReceiptJsonOptions) ?? throw new InvalidOperationException(
                "The stored checklist command result is invalid.");
            if (result.ReceiptId != receipt.PublicId)
            {
                throw new InvalidOperationException(
                    "The stored checklist command receipt identifier is invalid.");
            }

            return RampChecklistSubmissionWriteResult.Success(result, receipt.PublicId);
        }

        if (receipt.Status == MobileCommandStatus.Rejected)
        {
            var failure = receipt.ErrorCode switch
            {
                "not_found" => RampChecklistSubmissionWriteFailure.NotFound,
                "conflict" => RampChecklistSubmissionWriteFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "The stored checklist command rejection is invalid."),
            };
            return RampChecklistSubmissionWriteResult.Failed(failure, receipt.PublicId);
        }

        return Conflict();
    }

    private static string ComputePayloadHash(RampChecklistSubmissionWriteRequest request)
    {
        var canonical = new
        {
            command = CommandType,
            operationId = request.OperationId.ToString("D"),
            checklistId = request.ChecklistId.ToString("D"),
            answers = request.Answers
                .OrderBy(answer => answer.ItemId)
                .Select(answer => new
                {
                    itemId = answer.ItemId.ToString("D"),
                    value = answer.Value.ToString(),
                    answer.Note,
                })
                .ToArray(),
        };
        var payload = JsonSerializer.Serialize(canonical, ReceiptJsonOptions);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)))
            .ToLowerInvariant();
    }

    private static DateTimeOffset NormalizeToMilliseconds(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(
            utc.Ticks - (utc.Ticks % TimeSpan.TicksPerMillisecond),
            TimeSpan.Zero);
    }

    private static bool IsOperationalConflict(DbUpdateException exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        (sqlException.Number is 2601 or 2627 or 547 ||
         IsSerializationConflict(sqlException.Number));

    private static bool IsSerializationConflict(int errorNumber) =>
        errorNumber is 1205 or 1222 or 3960;

    private static bool IsSerializationConflict(Exception exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        IsSerializationConflict(sqlException.Number);

    private static RampChecklistSubmissionWriteResult Forbidden() =>
        RampChecklistSubmissionWriteResult.Failed(
            RampChecklistSubmissionWriteFailure.Forbidden);

    private static RampChecklistSubmissionWriteResult NotFound() =>
        RampChecklistSubmissionWriteResult.Failed(
            RampChecklistSubmissionWriteFailure.NotFound);

    private static RampChecklistSubmissionWriteResult Conflict() =>
        RampChecklistSubmissionWriteResult.Failed(
            RampChecklistSubmissionWriteFailure.Conflict);
}
