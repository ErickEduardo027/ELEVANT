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

/// <summary>Closes one assigned execution and appends its first OCC handoff atomically.</summary>
internal sealed class EfRampOperationSubmissionStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IRampOperationSubmissionStore
{
    private const string CommandType = "ramp.operation.submit.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<RampOperationSubmissionWriteResult> SubmitAsync(
        RampOperationSubmissionWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        RampOperationSubmissionWriteResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await SubmitInsideTransactionAsync(request, token);
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

    private async Task<RampOperationSubmissionWriteResult> SubmitInsideTransactionAsync(
        RampOperationSubmissionWriteRequest request,
        CancellationToken cancellationToken)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actorResult = await authorization.ResolveActorAsync(
            request.ActorAccountId, request.AllowedStationIds, request.InstallationId, cancellationToken);
        if (!actorResult.IsSuccess)
        {
            return RampOperationSubmissionWriteResult.Failed(
                actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                    ? RampOperationsFailure.Forbidden : RampOperationsFailure.NotFound);
        }

        var actor = actorResult.Access!;
        var device = actor.Device!;
        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var key = request.IdempotencyKey.ToString("D");
        var payloadHash = ComputePayloadHash(request);
        var existingReceipt = await context.MobileCommandReceipts
            .FromSqlInterpolated($"""
                SELECT * FROM [integration].[mobile_command_receipts] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id} AND [idempotency_key] = {key}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (existingReceipt is not null)
        {
            return Replay(existingReceipt, actor.AccountInternalId, payloadHash);
        }

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
        {
            return await RejectAsync(receipt, RampOperationsFailure.NotFound, "not_found", now, cancellationToken);
        }

        // The public ID survives receipt retention; a late retry may not append another revision.
        var prior = await context.OperationSubmissions
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[operation_submissions] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.IdempotencyKey}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is not null)
        {
            if (prior.GroundOperationId != scope.Operation.Id ||
                prior.SubmittedByRampAgentId != actor.RampAgentInternalId ||
                prior.AgentNote != request.AgentNote)
            {
                return await RejectAsync(receipt, RampOperationsFailure.Conflict, "conflict", now, cancellationToken);
            }

            var priorChecklist = await context.OperationChecklists.AsNoTracking()
                .SingleAsync(item => item.Id == prior.OperationChecklistId, cancellationToken);
            return await CompleteReceiptAsync(
                receipt, prior, priorChecklist.PublicId, scope.Operation.ActualEndAt ?? prior.SubmittedAt,
                request.OperationId, device, now, cancellationToken);
        }

        var checklist = await (
                from operationChecklist in context.OperationChecklists.AsNoTracking()
                join version in context.Set<ChecklistTemplateVersion>().AsNoTracking()
                    on operationChecklist.ChecklistTemplateVersionId equals version.Id
                join template in context.Set<ChecklistTemplate>().AsNoTracking()
                    on version.ChecklistTemplateId equals template.Id
                where operationChecklist.GroundOperationId == scope.Operation.Id &&
                      RampChecklists.Execution.Contains(template.Code)
                orderby operationChecklist.RevisionNumber descending,
                    version.VersionNumber descending
                select new
                {
                    operationChecklist.Id,
                    operationChecklist.PublicId,
                    operationChecklist.Status,
                    operationChecklist.RevisionNumber,
                })
            .FirstOrDefaultAsync(cancellationToken);
        var statuses = await context.OperationServices.AsNoTracking()
            .Where(service => service.GroundOperationId == scope.Operation.Id)
            .Select(service => service.CurrentStatus)
            .ToArrayAsync(cancellationToken);
        if (checklist is null || !RampOperationSubmissionPolicy.CanSubmit(
                scope.TurnaroundStatus,
                scope.Operation.CurrentStatus,
                scope.Operation.ActualStartAt,
                scope.Operation.ActualEndAt,
                checklist.Status,
                statuses))
        {
            return await RejectAsync(receipt, RampOperationsFailure.Conflict, "conflict", now, cancellationToken);
        }

        var previous = await context.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == scope.Operation.Id)
            .OrderByDescending(item => item.RevisionNumber)
            .Select(item => new { item.RevisionNumber, item.Status })
            .FirstOrDefaultAsync(cancellationToken);
        if (previous is not null && previous.Status != SubmissionStatus.Returned)
        {
            return await RejectAsync(receipt, RampOperationsFailure.Conflict, "conflict", now, cancellationToken);
        }

        var revision = checked((previous?.RevisionNumber ?? 0) + 1);
        if (checklist.RevisionNumber != revision)
        {
            return await RejectAsync(receipt, RampOperationsFailure.Conflict, "conflict", now, cancellationToken);
        }
        // 3-N09: the facts of the flight do not move to a resubmission. A correction round is measured to the first
        // hand-off (push-back, when it is missing, ends there) and the operation keeps that end; the new revision
        // records when it was resubmitted.
        var handedOffAt = previous is null
            ? now
            : await RampEvidenceWindowReader.FirstSubmittedAtAsync(context, scope.Operation.Id, cancellationToken) ?? now;
        // ADR-0034: the automatic surcharges are marked before the evidence OCC reviews is frozen; a resubmission also
        // retires the automatic ones its corrected times no longer justify.
        IReadOnlyList<string> automaticSurcharges;
        IReadOnlyList<string> retiredSurcharges = [];
        if (previous is null)
        {
            automaticSurcharges = await AutomaticSurchargeApplier.ApplyAsync(context, scope.Operation.Id, now,
                cancellationToken);
        }
        else
        {
            var reconciled = await AutomaticSurchargeApplier.ReconcileAsync(context, scope.Operation.Id, handedOffAt, now,
                actor.RampAgentInternalId, cancellationToken);
            automaticSurcharges = reconciled.Applied;
            retiredSurcharges = reconciled.Retired;
        }
        await context.SaveChangesAsync(cancellationToken);
        var submission = new OperationSubmission
        {
            PublicId = request.IdempotencyKey,
            GroundOperationId = scope.Operation.Id,
            OperationChecklistId = checklist.Id,
            RevisionNumber = revision,
            Status = SubmissionStatus.PendingReview,
            SubmittedByRampAgentId = actor.RampAgentInternalId,
            SubmittedAt = now,
            AgentNote = request.AgentNote,
            EvidenceJson = (await OperationSubmissionEvidence.CaptureAsync(
                context, scope.Operation.Id, cancellationToken, handedOffAt)).ToJson(),
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.OperationSubmissions.Add(submission);
        await OperationalNotificationWriter.NotifyOccAsync(
            context, scope.StationInternalId, scope.Operation.Id,
            submission.PublicId, "operation_submitted", now,
            actor.AccountInternalId, cancellationToken);

        scope.Operation.CurrentStatus = GroundOperationStatus.PendingReview;
        scope.Operation.ActualEndAt = handedOffAt;
        scope.Operation.UpdatedAt = now;
        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = scope.Operation.Id,
            FromStatus = GroundOperationStatus.InProgress,
            ToStatus = GroundOperationStatus.PendingReview,
            OccurredAt = now,
            ActorAccountId = actor.AccountInternalId,
            Reason = "Assigned ramp agent submitted completed execution for OCC review.",
        });

        var audit = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId,
            ActorDisplay = actor.DisplayName,
            Action = "ramp.operation.submitted",
            EntityType = nameof(OperationSubmission),
            EntityPublicId = submission.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Assigned ramp agent handed completed execution to OCC.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = scope.Operation.PublicId,
                turnaroundId = scope.TurnaroundPublicId,
                checklistId = checklist.PublicId,
                revision,
                rampAgentId = actor.RampAgentPublicId,
                installationId = device.InstallationId,
                automaticSurcharges,
                retiredSurcharges,
                handedOffAt,
            }, JsonOptions),
        };
        context.AuditEntries.Add(audit);

        await AirlineOperationChangeWriter.AddAsync(context,
            scope.AirlineOrganizationInternalId, scope.Operation.PublicId, now,
            cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, scope.Operation.Id, now, true, cancellationToken);

        var result = await CompleteReceiptAsync(
            receipt, submission, checklist.PublicId, handedOffAt, request.OperationId,
            device, now, cancellationToken);
        context.AuditChanges.AddRange(
            new AuditChange
            {
                AuditEntryId = audit.Id,
                PropertyName = nameof(GroundOperation.CurrentStatus),
                OldValue = GroundOperationStatus.InProgress.ToString(),
                NewValue = GroundOperationStatus.PendingReview.ToString(),
            },
            new AuditChange
            {
                AuditEntryId = audit.Id,
                PropertyName = nameof(GroundOperation.ActualEndAt),
                OldValue = null,
                NewValue = handedOffAt.ToString("O"),
            });
        await context.SaveChangesAsync(cancellationToken);
        return result;
    }

    private async Task<RampOperationSubmissionWriteResult> CompleteReceiptAsync(
        MobileCommandReceipt receipt,
        OperationSubmission submission,
        Guid checklistId,
        DateTimeOffset actualEndAt,
        Guid operationId,
        MobileDevice device,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var result = new RampOperationSubmissionData(
            receipt.PublicId,
            operationId,
            submission.PublicId,
            checklistId,
            submission.RevisionNumber,
            submission.Status.ToString(),
            submission.SubmittedAt,
            actualEndAt,
            submission.AgentNote);
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(result, JsonOptions);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampOperationSubmissionWriteResult.Success(result, receipt.PublicId);
    }

    private async Task<RampOperationSubmissionWriteResult> RejectAsync(
        MobileCommandReceipt receipt,
        RampOperationsFailure failure,
        string code,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        receipt.Status = MobileCommandStatus.Rejected;
        receipt.ProcessedAt = now;
        receipt.ErrorCode = code;
        receipt.ErrorMessage = "The operation is not ready for review.";
        receipt.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampOperationSubmissionWriteResult.Failed(failure, receipt.PublicId);
    }

    private static RampOperationSubmissionWriteResult Replay(
        MobileCommandReceipt receipt,
        long actorAccountId,
        string payloadHash)
    {
        if (receipt.AccountId != actorAccountId || receipt.CommandType != CommandType ||
            receipt.PayloadHash != payloadHash)
        {
            return Conflict();
        }

        if (receipt.Status == MobileCommandStatus.Processed &&
            !string.IsNullOrWhiteSpace(receipt.ResultJson))
        {
            var result = JsonSerializer.Deserialize<RampOperationSubmissionData>(
                receipt.ResultJson, JsonOptions)
                ?? throw new InvalidOperationException("The stored submission receipt is invalid.");
            if (result.ReceiptId != receipt.PublicId)
            {
                throw new InvalidOperationException("The stored submission receipt ID is invalid.");
            }
            return RampOperationSubmissionWriteResult.Success(result, receipt.PublicId);
        }

        if (receipt.Status == MobileCommandStatus.Rejected)
        {
            return RampOperationSubmissionWriteResult.Failed(receipt.ErrorCode switch
            {
                "not_found" => RampOperationsFailure.NotFound,
                "conflict" => RampOperationsFailure.Conflict,
                _ => throw new InvalidOperationException("The stored submission rejection is invalid."),
            }, receipt.PublicId);
        }

        return Conflict();
    }

    private static string ComputePayloadHash(RampOperationSubmissionWriteRequest request)
    {
        var payload = JsonSerializer.Serialize(new
        {
            command = CommandType,
            operationId = request.OperationId.ToString("D"),
            request.AgentNote,
        }, JsonOptions);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)))
            .ToLowerInvariant();
    }

    private static DateTimeOffset NormalizeToMilliseconds(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static RampOperationSubmissionWriteResult Conflict() =>
        RampOperationSubmissionWriteResult.Failed(RampOperationsFailure.Conflict);

    private static bool IsOperationalConflict(DbUpdateException exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        (sqlException.Number is 2601 or 2627 or 547 || IsSerializationConflict(sqlException.Number));

    private static bool IsSerializationConflict(int number) => number is 1205 or 1222 or 3960;

    private static bool IsSerializationConflict(Exception exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        IsSerializationConflict(sqlException.Number);
}
