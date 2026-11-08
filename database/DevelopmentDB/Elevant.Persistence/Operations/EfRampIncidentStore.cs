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

/// <summary>Reads assigned incidents and commits one idempotent report at a time.</summary>
internal sealed class EfRampIncidentStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IRampIncidentStore
{
    private const string CommandType = "ramp.operation.incident.report.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<RampIncidentReadResult> GetAsync(
        RampIncidentReadRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            context.ChangeTracker.Clear();
            var authorization = new EfRampExecutionAuthorization(context, timeProvider);
            var actor = await authorization.ResolveActorAsync(
                request.ActorAccountId, request.AllowedStationIds, null, cancellationToken);
            if (!actor.IsSuccess)
            {
                await transaction.CommitAsync(cancellationToken);
                return RampIncidentReadResult.Failed(actor.Failure == RampExecutionAuthorizationFailure.Forbidden
                    ? RampOperationsFailure.Forbidden : RampOperationsFailure.NotFound);
            }

            var scope = await authorization.ResolveOperationAsync(
                actor.Access!, request.OperationId, false, cancellationToken);
            if (scope is null)
            {
                await transaction.CommitAsync(cancellationToken);
                return RampIncidentReadResult.Failed(RampOperationsFailure.NotFound);
            }

            var incidents = await context.Incidents.AsNoTracking()
                .Where(incident => incident.GroundOperationId == scope.Operation.Id)
                .OrderBy(incident => incident.OccurredAt)
                .ThenBy(incident => incident.ReportedAt)
                .ThenBy(incident => incident.PublicId)
                .Select(incident => new RampIncidentData(
                    incident.PublicId,
                    incident.IncidentType,
                    incident.Severity.ToString(),
                    incident.Status.ToString(),
                    incident.Description,
                    incident.OccurredAt,
                    incident.ReportedAt,
                    incident.DelayCode))
                .ToArrayAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return RampIncidentReadResult.Success(incidents);
        });
    }

    public async Task<RampIncidentWriteResult> ReportAsync(
        RampIncidentWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        RampIncidentWriteResult? attemptResult = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attemptResult = await ReportInsideTransactionAsync(request, token);
                    if (attemptResult.CommitReceiptId is null) context.ChangeTracker.Clear();
                    return attemptResult;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    return attemptResult?.CommitReceiptId is not Guid receiptId ||
                        await context.MobileCommandReceipts.AsNoTracking()
                            .AnyAsync(item => item.PublicId == receiptId, token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return RampIncidentWriteResult.Failed(RampOperationsFailure.Conflict);
        }
        catch (RetryLimitExceededException exception) when (IsSerializationConflict(exception))
        {
            context.ChangeTracker.Clear();
            return RampIncidentWriteResult.Failed(RampOperationsFailure.Conflict);
        }
        catch (DbUpdateException exception) when (IsOperationalConflict(exception))
        {
            context.ChangeTracker.Clear();
            return RampIncidentWriteResult.Failed(RampOperationsFailure.Conflict);
        }
        catch (SqlException exception) when (IsSerializationConflict(exception.Number))
        {
            context.ChangeTracker.Clear();
            return RampIncidentWriteResult.Failed(RampOperationsFailure.Conflict);
        }
    }

    private async Task<RampIncidentWriteResult> ReportInsideTransactionAsync(
        RampIncidentWriteRequest request,
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
            return RampIncidentWriteResult.Failed(actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                ? RampOperationsFailure.Forbidden : RampOperationsFailure.NotFound);
        }

        var actor = actorResult.Access!;
        var device = actor.Device!;
        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var occurredAt = NormalizeToMilliseconds(request.OccurredAt);
        var key = request.IdempotencyKey.ToString("D");
        var payloadHash = ComputePayloadHash(request, occurredAt);
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

        var priorIncident = await context.Incidents
            .FromSqlInterpolated($"""
                SELECT * FROM [ops].[incidents] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.IdempotencyKey}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (priorIncident is not null)
        {
            if (priorIncident.GroundOperationId != scope.Operation.Id ||
                priorIncident.ReportedByRampAgentId != actor.RampAgentInternalId ||
                priorIncident.IncidentType != request.IncidentType ||
                priorIncident.Severity != request.Severity ||
                priorIncident.Description != request.Description ||
                priorIncident.DelayCode != request.DelayCode ||
                // The stored time was clamped to the server's clock when it was first reported.
                priorIncident.OccurredAt != RampEvidenceTimePolicy.Clamp(occurredAt, priorIncident.ReportedAt))
            {
                return await RejectAsync(receipt, RampOperationsFailure.Conflict, "conflict", now, cancellationToken);
            }

            return await CompleteReceiptAsync(receipt, priorIncident, request.OperationId, now, device, cancellationToken);
        }

        // 3-N25: the same window as the milestones and the damages, with the clock tolerance on both ends; the time
        // is stored clamped to the server's clock (ck_incident_reported).
        var window = await RampEvidenceWindowReader.ReadAsync(context, scope.Operation, now, cancellationToken);
        if (RampIncidentPolicy.ReportRejection(
                scope.TurnaroundStatus,
                scope.Operation.CurrentStatus,
                scope.Operation.ActualStartAt,
                scope.Operation.ActualEndAt,
                occurredAt,
                window) is { } rejection)
        {
            return await RejectAsync(receipt, RampOperationsFailure.Conflict, rejection, now, cancellationToken);
        }

        var incident = new Incident
        {
            PublicId = request.IdempotencyKey,
            GroundOperationId = scope.Operation.Id,
            ReportedByRampAgentId = actor.RampAgentInternalId,
            IncidentType = request.IncidentType,
            Severity = request.Severity,
            Status = IncidentStatus.Open,
            Description = request.Description,
            DelayCode = request.DelayCode,
            OccurredAt = RampEvidenceTimePolicy.Clamp(occurredAt, now),
            ReportedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.Incidents.Add(incident);
        // 3-G: the report is the first step of the incident's history OCC follows; the tablet's answer is unchanged.
        await context.SaveChangesAsync(cancellationToken);
        context.Set<IncidentStatusEvent>().Add(new IncidentStatusEvent
        {
            IncidentId = incident.Id,
            FromStatus = null,
            ToStatus = IncidentStatus.Open,
            Note = EfOccIncidentStore.RampReportedNote,
            OccurredAt = now,
            ActorAccountId = actor.AccountInternalId,
        });
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId,
            ActorDisplay = actor.DisplayName,
            Action = "ramp.operation.incident.reported",
            EntityType = nameof(Incident),
            EntityPublicId = incident.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Assigned ramp agent reported an operational incident.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = scope.Operation.PublicId,
                turnaroundId = scope.TurnaroundPublicId,
                rampAgentId = actor.RampAgentPublicId,
                incidentType = incident.IncidentType,
                severity = incident.Severity.ToString(),
                installationId = device.InstallationId,
            }, JsonOptions),
        });
        await RampOperationChangeWriter.AnnounceAsync(context, scope.Operation.Id, now, false, cancellationToken);
        await OperationalNotificationWriter.NotifyOccAsync(context, scope.StationInternalId, scope.Operation.Id,
            // A deviation from the normal process is its own alert kind for OCC (ADR-0031).
            incident.PublicId, incident.IncidentType == RampIncidentPolicy.Deviation ? "deviation_reported" : "incident_reported", now, actor.AccountInternalId, cancellationToken);
        return await CompleteReceiptAsync(receipt, incident, request.OperationId, now, device, cancellationToken);
    }

    private async Task<RampIncidentWriteResult> CompleteReceiptAsync(
        MobileCommandReceipt receipt,
        Incident incident,
        Guid operationId,
        DateTimeOffset now,
        MobileDevice device,
        CancellationToken cancellationToken)
    {
        var result = new RampIncidentReceiptData(
            receipt.PublicId,
            operationId,
            incident.PublicId,
            incident.Status.ToString(),
            incident.OccurredAt,
            incident.ReportedAt);
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(result, JsonOptions);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampIncidentWriteResult.Success(result, receipt.PublicId);
    }

    private async Task<RampIncidentWriteResult> RejectAsync(
        MobileCommandReceipt receipt,
        RampOperationsFailure failure,
        string errorCode,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        receipt.Status = MobileCommandStatus.Rejected;
        receipt.ProcessedAt = now;
        receipt.ErrorCode = errorCode;
        receipt.ErrorMessage = errorCode == RampProblemCodes.TimeOutsideOperationWindow
            ? "The incident time is outside the operation's window."
            : "The incident request conflicts with current operational data.";
        receipt.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampIncidentWriteResult.Failed(failure, receipt.PublicId, RampProblemCodes.PublicCode(errorCode));
    }

    private static RampIncidentWriteResult Replay(
        MobileCommandReceipt receipt,
        long accountId,
        string payloadHash)
    {
        if (receipt.AccountId != accountId || receipt.CommandType != CommandType ||
            receipt.PayloadHash != payloadHash)
        {
            return RampIncidentWriteResult.Failed(RampOperationsFailure.Conflict, code: RampProblemCodes.IdempotencyConflict);
        }

        if (receipt.Status == MobileCommandStatus.Processed &&
            !string.IsNullOrWhiteSpace(receipt.ResultJson))
        {
            var result = JsonSerializer.Deserialize<RampIncidentReceiptData>(receipt.ResultJson, JsonOptions)
                ?? throw new InvalidOperationException("The stored incident receipt is invalid.");
            if (result.ReceiptId != receipt.PublicId)
            {
                throw new InvalidOperationException("The stored incident receipt ID is invalid.");
            }
            return RampIncidentWriteResult.Success(result, receipt.PublicId);
        }

        if (receipt.Status == MobileCommandStatus.Rejected)
        {
            return RampIncidentWriteResult.Failed(receipt.ErrorCode switch
            {
                "not_found" => RampOperationsFailure.NotFound,
                "conflict" or RampProblemCodes.TimeOutsideOperationWindow => RampOperationsFailure.Conflict,
                _ => throw new InvalidOperationException("The stored incident rejection is invalid."),
            }, receipt.PublicId, RampProblemCodes.PublicCode(receipt.ErrorCode));
        }

        return RampIncidentWriteResult.Failed(RampOperationsFailure.Conflict);
    }

    private static string ComputePayloadHash(RampIncidentWriteRequest request, DateTimeOffset occurredAt)
    {
        var payload = JsonSerializer.Serialize(new
        {
            command = CommandType,
            operationId = request.OperationId.ToString("D"),
            incidentType = request.IncidentType,
            severity = request.Severity.ToString(),
            description = request.Description,
            occurredAt,
            delayCode = request.DelayCode,
        }, JsonOptions);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    private static DateTimeOffset NormalizeToMilliseconds(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static bool IsOperationalConflict(DbUpdateException exception) =>
        exception.GetBaseException() is SqlException sqlException &&
        (sqlException.Number is 2601 or 2627 or 547 || IsSerializationConflict(sqlException.Number));
    private static bool IsSerializationConflict(int number) => number is 1205 or 1222 or 3960;
    private static bool IsSerializationConflict(Exception exception) =>
        exception.GetBaseException() is SqlException sqlException && IsSerializationConflict(sqlException.Number);
}
