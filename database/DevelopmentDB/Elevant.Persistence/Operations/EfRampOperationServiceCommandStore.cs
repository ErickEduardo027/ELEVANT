using System.Data;
using System.Globalization;
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

/// <summary>Atomically commits one state transition for an assigned service.</summary>
internal sealed class EfRampOperationServiceCommandStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IRampOperationServiceCommandStore
{
    private const string CommandType = "ramp.operation.service.transition.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions ReceiptJsonOptions =
        new(JsonSerializerDefaults.Web);

    public async Task<RampOperationServiceTransitionWriteResult> TransitionServiceAsync(
        RampOperationServiceTransitionWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var strategy = context.Database.CreateExecutionStrategy();
        RampOperationServiceTransitionWriteResult? attemptResult = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async operationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    attemptResult = await TransitionInsideTransactionAsync(
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

    private async Task<RampOperationServiceTransitionWriteResult> TransitionInsideTransactionAsync(
        RampOperationServiceTransitionWriteRequest request,
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
                RampOperationServiceTransitionWriteFailure.NotFound,
                "not_found",
                "The ramp operation or service was not found.",
                now,
                cancellationToken);
        }

        var service = await context.OperationServices
            .FromSqlInterpolated($"""
                SELECT *
                FROM [ops].[operation_services] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.ServiceId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (service is null || service.GroundOperationId != scope.Operation.Id)
        {
            return await RejectAsync(
                receipt,
                RampOperationServiceTransitionWriteFailure.NotFound,
                "not_found",
                "The ramp operation or service was not found.",
                now,
                cancellationToken);
        }

        var latestSubmission = await context.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == scope.Operation.Id)
            .OrderByDescending(item => item.RevisionNumber)
            .Select(item => new { item.RevisionNumber, item.Status })
            .FirstOrDefaultAsync(cancellationToken);
        var isCorrectionRound = latestSubmission is { Status: SubmissionStatus.Returned } &&
            await context.OperationChecklists.AsNoTracking().AnyAsync(item =>
                item.GroundOperationId == scope.Operation.Id &&
                item.RevisionNumber == latestSubmission.RevisionNumber + 1,
                cancellationToken);
        if (!RampOperationServiceTransitionPolicy.CanTransition(
                scope.TurnaroundStatus,
                scope.Operation.CurrentStatus,
                scope.Operation.ActualStartAt,
                scope.Operation.ActualEndAt,
                service.CurrentStatus,
                request.TargetStatus,
                request.ExecutedQuantity,
                request.Note,
                isCorrectionRound))
        {
            return await RejectAsync(
                receipt,
                RampOperationServiceTransitionWriteFailure.Conflict,
                "conflict",
                "The service transition conflicts with canonical operational data.",
                now,
                cancellationToken);
        }

        // 3-I: the moment the agent tapped the transition, possibly sent later from the offline queue. It fits the
        // operation's window and never precedes the service's last transition; without it the server's time applies.
        var occurredAt = now;
        if (request.OccurredAt is { } tapped)
        {
            occurredAt = NormalizeToMilliseconds(tapped);
            var window = await RampEvidenceWindowReader.ReadAsync(context, scope.Operation, now, cancellationToken);
            var lastEventAt = await context.Set<OperationServiceStatusEvent>().AsNoTracking()
                .Where(item => item.OperationServiceId == service.Id)
                .MaxAsync(item => (DateTimeOffset?)item.OccurredAt, cancellationToken);
            if (RampEvidenceTimePolicy.CheckServiceTime(occurredAt, window.Opens, lastEventAt, now) is { } broken)
            {
                return await RejectAsync(
                    receipt,
                    RampOperationServiceTransitionWriteFailure.Conflict,
                    broken,
                    broken == RampProblemCodes.ServiceTimeOutOfOrder
                        ? "The transition is earlier than the service's last transition."
                        : "The transition time is outside the operation's window.",
                    now,
                    cancellationToken);
            }

            occurredAt = RampEvidenceTimePolicy.Clamp(occurredAt, now);
        }

        var previousStatus = service.CurrentStatus;
        var previousQuantity = service.ExecutedQuantity;
        service.CurrentStatus = request.TargetStatus;
        if (request.TargetStatus == ServiceExecutionStatus.InProgress &&
            previousStatus is ServiceExecutionStatus.Completed or
                ServiceExecutionStatus.NotPerformed or ServiceExecutionStatus.Exception)
        {
            service.ExecutedQuantity = 0m;
        }
        else if (request.TargetStatus != ServiceExecutionStatus.InProgress)
        {
            service.ExecutedQuantity = request.ExecutedQuantity!.Value;
        }
        service.UpdatedAt = now;
        context.Set<OperationServiceStatusEvent>().Add(new OperationServiceStatusEvent
        {
            OperationServiceId = service.Id,
            FromStatus = previousStatus,
            ToStatus = request.TargetStatus,
            OccurredAt = occurredAt,
            RampAgentId = actor.RampAgentInternalId,
            Note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
        });

        var auditEntry = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId,
            ActorDisplay = actor.DisplayName,
            Action = "ramp.operation.service.transitioned",
            EntityType = nameof(OperationService),
            EntityPublicId = service.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Assigned ramp agent transitioned an operation service.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = scope.Operation.PublicId,
                turnaroundId = scope.TurnaroundPublicId,
                rampAgentId = actor.RampAgentPublicId,
                targetStatus = request.TargetStatus.ToString(),
                executedQuantity = service.ExecutedQuantity,
                installationId = device.InstallationId,
                // 3-I: when the command reached the server and when the agent tapped it.
                receivedAt = now,
                occurredAt,
            }, ReceiptJsonOptions),
        };
        context.AuditEntries.Add(auditEntry);

        await RampOperationChangeWriter.AnnounceAsync(context, service.GroundOperationId, now, false, cancellationToken);
        var transition = new RampOperationServiceTransitionData(
            receipt.PublicId,
            new RampOperationServiceExecutionData(
                service.PublicId,
                service.CurrentStatus.ToString(),
                service.ContractedQuantity,
                service.ExecutedQuantity,
                service.BillingUnitSnapshot));
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(transition, ReceiptJsonOptions);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;

        await context.SaveChangesAsync(cancellationToken);
        var auditChanges = new List<AuditChange>
        {
            new()
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = nameof(OperationService.CurrentStatus),
                OldValue = previousStatus.ToString(),
                NewValue = service.CurrentStatus.ToString(),
            },
        };
        if (previousQuantity != service.ExecutedQuantity)
        {
            auditChanges.Add(new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = nameof(OperationService.ExecutedQuantity),
                OldValue = previousQuantity.ToString("G29", CultureInfo.InvariantCulture),
                NewValue = service.ExecutedQuantity.ToString("G29", CultureInfo.InvariantCulture),
            });
        }
        context.AuditChanges.AddRange(auditChanges);
        await context.SaveChangesAsync(cancellationToken);

        return RampOperationServiceTransitionWriteResult.Success(
            transition,
            receipt.PublicId);
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

    private async Task<RampOperationServiceTransitionWriteResult> RejectAsync(
        MobileCommandReceipt receipt,
        RampOperationServiceTransitionWriteFailure failure,
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
        return RampOperationServiceTransitionWriteResult.Failed(
            failure,
            receipt.PublicId,
            RampProblemCodes.PublicCode(errorCode));
    }

    private static RampOperationServiceTransitionWriteResult Replay(
        MobileCommandReceipt receipt,
        long actorAccountId,
        string payloadHash)
    {
        if (receipt.AccountId != actorAccountId ||
            !string.Equals(receipt.CommandType, CommandType, StringComparison.Ordinal) ||
            !string.Equals(receipt.PayloadHash, payloadHash, StringComparison.Ordinal))
        {
            return RampOperationServiceTransitionWriteResult.Failed(
                RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict);
        }

        if (receipt.Status == MobileCommandStatus.Processed &&
            !string.IsNullOrWhiteSpace(receipt.ResultJson))
        {
            var result = JsonSerializer.Deserialize<RampOperationServiceTransitionData>(
                receipt.ResultJson,
                ReceiptJsonOptions) ?? throw new InvalidOperationException(
                "The stored service command result is invalid.");
            if (result.ReceiptId != receipt.PublicId)
            {
                throw new InvalidOperationException(
                    "The stored service command receipt identifier is invalid.");
            }

            return RampOperationServiceTransitionWriteResult.Success(
                result,
                receipt.PublicId);
        }

        if (receipt.Status == MobileCommandStatus.Rejected)
        {
            var failure = receipt.ErrorCode switch
            {
                "not_found" => RampOperationServiceTransitionWriteFailure.NotFound,
                "conflict" or RampProblemCodes.TimeOutsideOperationWindow or RampProblemCodes.ServiceTimeOutOfOrder =>
                    RampOperationServiceTransitionWriteFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "The stored service command rejection is invalid."),
            };
            return RampOperationServiceTransitionWriteResult.Failed(
                failure,
                receipt.PublicId,
                RampProblemCodes.PublicCode(receipt.ErrorCode));
        }

        return Conflict();
    }

    /// <summary>
    /// The receipt hash of a transition. Without a tapped time the canonical payload is byte for byte the one of the
    /// first version, so a transition the deployed APK queued replays instead of conflicting (3-I); a tapped time,
    /// truncated to milliseconds, extends it.
    /// </summary>
    internal static string ComputePayloadHash(
        RampOperationServiceTransitionWriteRequest request)
    {
        var operationId = request.OperationId.ToString("D");
        var serviceId = request.ServiceId.ToString("D");
        var targetStatus = request.TargetStatus.ToString();
        var executedQuantity = request.ExecutedQuantity?.ToString("G29", CultureInfo.InvariantCulture);
        var payload = request.OccurredAt is { } tapped
            ? JsonSerializer.Serialize(new
            {
                command = CommandType,
                operationId,
                serviceId,
                targetStatus,
                executedQuantity,
                request.Note,
                occurredAt = NormalizeToMilliseconds(tapped),
            }, ReceiptJsonOptions)
            : JsonSerializer.Serialize(new
            {
                command = CommandType,
                operationId,
                serviceId,
                targetStatus,
                executedQuantity,
                request.Note,
            }, ReceiptJsonOptions);
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

    private static RampOperationServiceTransitionWriteResult Forbidden() =>
        RampOperationServiceTransitionWriteResult.Failed(
            RampOperationServiceTransitionWriteFailure.Forbidden);

    private static RampOperationServiceTransitionWriteResult NotFound() =>
        RampOperationServiceTransitionWriteResult.Failed(
            RampOperationServiceTransitionWriteFailure.NotFound);

    private static RampOperationServiceTransitionWriteResult Conflict() =>
        RampOperationServiceTransitionWriteResult.Failed(
            RampOperationServiceTransitionWriteFailure.Conflict);
}
