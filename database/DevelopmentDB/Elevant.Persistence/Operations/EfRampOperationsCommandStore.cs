using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Operations;

/// <summary>Commits idempotent ramp-agent operation transitions.</summary>
internal sealed class EfRampOperationsCommandStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IRampOperationsCommandStore
{
    private const string StartCommandType = "ramp.operation.start.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions ReceiptJsonOptions =
        new(JsonSerializerDefaults.Web);

    public async Task<RampOperationStartWriteResult> StartOperationAsync(
        RampOperationStartWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var strategy = context.Database.CreateExecutionStrategy();
        RampOperationStartWriteResult? attemptResult = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async operationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    attemptResult = await StartInsideTransactionAsync(
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

    private async Task<RampOperationStartWriteResult> StartInsideTransactionAsync(
        RampOperationStartWriteRequest request,
        CancellationToken cancellationToken)
    {
        var allowedStationIds = request.AllowedStationIds
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
        if (allowedStationIds.Length == 0)
        {
            return Forbidden();
        }

        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (liveActor is null ||
            liveActor.AccountId != request.ActorAccountId ||
            !RampOperationsAccess.IsAuthorized(liveActor))
        {
            return Forbidden();
        }

        var liveStationIds = liveActor.StationScopes
            .Select(scope => scope.StationId)
            .ToHashSet();
        var stationPublicIds = allowedStationIds
            .Where(liveStationIds.Contains)
            .ToArray();
        if (stationPublicIds.Length == 0)
        {
            return Forbidden();
        }

        var actorProfiles = await (
                from account in context.Users.AsNoTracking()
                join agent in context.RampAgents.AsNoTracking()
                    on account.PersonId equals agent.PersonId
                where account.PublicId == request.ActorAccountId && agent.IsActive
                select new ActorProfile(account.Id, agent.Id, agent.PublicId))
            .Take(2)
            .ToArrayAsync(cancellationToken);
        if (actorProfiles.Length != 1)
        {
            return Forbidden();
        }

        var actor = actorProfiles[0];
        var device = await context.MobileDevices
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_devices] WITH (UPDLOCK, HOLDLOCK)
                WHERE [installation_id] = {request.InstallationId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (device is null || device.RevokedAt is not null)
        {
            return Forbidden();
        }

        var binding = await context.Set<MobileDeviceAccountBinding>()
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_device_account_bindings] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id}
                  AND [unbound_at] IS NULL
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (binding is null || binding.AccountId != actor.AccountInternalId)
        {
            return Forbidden();
        }

        var idempotencyKey = request.IdempotencyKey.ToString("D");
        var payloadHash = ComputePayloadHash(request.OperationId);
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

        var receipt = new MobileCommandReceipt
        {
            PublicId = Guid.CreateVersion7(),
            MobileDeviceId = device.Id,
            AccountId = actor.AccountInternalId,
            IdempotencyKey = idempotencyKey,
            CommandType = StartCommandType,
            PayloadHash = payloadHash,
            Status = MobileCommandStatus.Received,
            ReceivedAt = now,
            ExpiresAt = now.Add(ReceiptRetention),
            CreatedAt = now,
            UpdatedAt = now,
        };
        context.MobileCommandReceipts.Add(receipt);

        var operation = await context.GroundOperations
            .FromSqlInterpolated($"""
                SELECT *
                FROM [ops].[ground_operations] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.OperationId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (operation is null)
        {
            return await RejectAsync(
                receipt,
                RampOperationStartWriteFailure.NotFound,
                "not_found",
                "The ramp operation was not found.",
                now,
                cancellationToken);
        }

        var scope = await (
                from turnaround in context.Turnarounds.AsNoTracking()
                join station in context.Stations.AsNoTracking()
                    on turnaround.StationId equals station.Id
                join airline in context.Airlines.AsNoTracking()
                    on turnaround.AirlineId equals airline.Id
                where turnaround.Id == operation.TurnaroundId &&
                      station.IsActive &&
                      stationPublicIds.Contains(station.PublicId)
                select new OperationScope(
                    turnaround.PublicId,
                    turnaround.OperationDate,
                    turnaround.CurrentStatus,
                    station.Id,
                    airline.OrganizationId))
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null)
        {
            return await RejectAsync(
                receipt,
                RampOperationStartWriteFailure.NotFound,
                "not_found",
                "The ramp operation was not found.",
                now,
                cancellationToken);
        }

        var hasActiveAssignment = await context.OperationAgentAssignments
            .AsNoTracking()
            .AnyAsync(
                assignment => assignment.GroundOperationId == operation.Id &&
                    assignment.RampAgentId == actor.RampAgentInternalId &&
                    assignment.ReleasedAt == null,
                cancellationToken);
        var hasStationScope = await context.Set<RampAgentStationScope>()
            .AsNoTracking()
            .AnyAsync(
                agentScope => agentScope.RampAgentId == actor.RampAgentInternalId &&
                    agentScope.StationId == scope.StationInternalId &&
                    agentScope.ValidFrom <= scope.OperationDate &&
                    (agentScope.ValidTo == null ||
                     agentScope.ValidTo >= scope.OperationDate),
                cancellationToken);
        if (!hasActiveAssignment || !hasStationScope)
        {
            return await RejectAsync(
                receipt,
                RampOperationStartWriteFailure.NotFound,
                "not_found",
                "The ramp operation was not found.",
                now,
                cancellationToken);
        }

        var stand = await (
                from assignment in context.Set<StandAssignment>().AsNoTracking()
                join item in context.Stands.AsNoTracking()
                    on assignment.StandId equals item.Id
                where assignment.TurnaroundId == operation.TurnaroundId &&
                      assignment.AssignedTo == null
                select new StandScope(item.StationId, item.TerminalId, item.IsActive))
            .SingleOrDefaultAsync(cancellationToken);
        if (stand is not null &&
            (!stand.IsActive || stand.StationInternalId != scope.StationInternalId))
        {
            return await RejectAsync(
                receipt,
                RampOperationStartWriteFailure.NotFound,
                "not_found",
                "The ramp operation was not found.",
                now,
                cancellationToken);
        }

        if (stand?.TerminalInternalId is long terminalId)
        {
            var hasTerminalScope = await (
                    from terminal in context.Terminals.AsNoTracking()
                    where terminal.Id == terminalId &&
                          terminal.StationId == scope.StationInternalId &&
                          terminal.IsActive &&
                          context.Set<RampAgentTerminalScope>().AsNoTracking().Any(agentScope =>
                              agentScope.RampAgentId == actor.RampAgentInternalId &&
                              agentScope.TerminalId == terminal.Id &&
                              agentScope.ValidFrom <= scope.OperationDate &&
                              (agentScope.ValidTo == null ||
                               agentScope.ValidTo >= scope.OperationDate))
                    select terminal.Id)
                .AnyAsync(cancellationToken);
            if (!hasTerminalScope)
            {
                return await RejectAsync(
                    receipt,
                    RampOperationStartWriteFailure.NotFound,
                    "not_found",
                    "The ramp operation was not found.",
                    now,
                    cancellationToken);
            }
        }

        if (!RampOperationStartPolicy.CanStart(
                scope.TurnaroundStatus,
                operation.CurrentStatus,
                operation.ActualStartAt,
                operation.ActualEndAt))
        {
            return await RejectAsync(
                receipt,
                RampOperationStartWriteFailure.Conflict,
                "conflict",
                "The ramp operation cannot be started in its current state.",
                now,
                cancellationToken);
        }

        operation.CurrentStatus = GroundOperationStatus.InProgress;
        operation.ActualStartAt = now;
        operation.UpdatedAt = now;
        context.Set<GroundOperationStatusEvent>().Add(new GroundOperationStatusEvent
        {
            GroundOperationId = operation.Id,
            FromStatus = GroundOperationStatus.Assigned,
            ToStatus = GroundOperationStatus.InProgress,
            OccurredAt = now,
            ActorAccountId = actor.AccountInternalId,
            Reason = "Operation started by the assigned ramp agent.",
        });

        var auditEntry = new AuditEntry
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = now,
            ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId,
            ActorDisplay = liveActor.DisplayName,
            Action = "ramp.operation.started",
            EntityType = nameof(GroundOperation),
            EntityPublicId = operation.PublicId,
            OrganizationId = scope.AirlineOrganizationInternalId,
            StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync,
            CorrelationId = request.CorrelationId,
            RequestId = request.RequestId,
            Reason = "Assigned ramp agent started the operation.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                turnaroundId = scope.TurnaroundPublicId,
                rampAgentId = actor.RampAgentPublicId,
                installationId = device.InstallationId,
            }, ReceiptJsonOptions),
        };
        context.AuditEntries.Add(auditEntry);
        await AirlineOperationChangeWriter.AddAsync(context,
            scope.AirlineOrganizationInternalId, operation.PublicId, now,
            cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Id, now, false, cancellationToken);
        await OperationalNotificationWriter.NotifyOccAsync(context, scope.StationInternalId, operation.Id,
            operation.PublicId, "operation_started", now, null, cancellationToken);

        var start = new RampOperationStartData(
            receipt.PublicId,
            new RampGroundOperationData(
                operation.PublicId,
                operation.CurrentStatus.ToString(),
                operation.PlannedStartAt,
                operation.PlannedEndAt,
                operation.ActualStartAt,
                operation.ActualEndAt));
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(start, ReceiptJsonOptions);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;

        await context.SaveChangesAsync(cancellationToken);

        context.AuditChanges.AddRange(
            new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = nameof(GroundOperation.CurrentStatus),
                OldValue = GroundOperationStatus.Assigned.ToString(),
                NewValue = GroundOperationStatus.InProgress.ToString(),
            },
            new AuditChange
            {
                AuditEntryId = auditEntry.Id,
                PropertyName = nameof(GroundOperation.ActualStartAt),
                NewValue = now.ToString("O"),
            });
        await context.SaveChangesAsync(cancellationToken);

        return RampOperationStartWriteResult.Success(start, receipt.PublicId);
    }

    private async Task<RampOperationStartWriteResult> RejectAsync(
        MobileCommandReceipt receipt,
        RampOperationStartWriteFailure failure,
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
        return RampOperationStartWriteResult.Failed(failure, receipt.PublicId);
    }

    private static RampOperationStartWriteResult Replay(
        MobileCommandReceipt receipt,
        long actorAccountId,
        string payloadHash)
    {
        if (receipt.AccountId != actorAccountId ||
            !string.Equals(receipt.CommandType, StartCommandType, StringComparison.Ordinal) ||
            !string.Equals(receipt.PayloadHash, payloadHash, StringComparison.Ordinal))
        {
            return RampOperationStartWriteResult.Failed(
                RampOperationStartWriteFailure.IdempotencyKeyConflict);
        }

        if (receipt.Status == MobileCommandStatus.Processed &&
            !string.IsNullOrWhiteSpace(receipt.ResultJson))
        {
            var result = JsonSerializer.Deserialize<RampOperationStartData>(
                receipt.ResultJson,
                ReceiptJsonOptions) ?? throw new InvalidOperationException(
                    "The stored mobile command result is invalid.");
            if (result.ReceiptId != receipt.PublicId)
            {
                throw new InvalidOperationException(
                    "The stored mobile command receipt identifier is invalid.");
            }

            return RampOperationStartWriteResult.Success(result, receipt.PublicId);
        }

        if (receipt.Status == MobileCommandStatus.Rejected)
        {
            var failure = receipt.ErrorCode switch
            {
                "not_found" => RampOperationStartWriteFailure.NotFound,
                "conflict" => RampOperationStartWriteFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "The stored mobile command rejection is invalid."),
            };
            return RampOperationStartWriteResult.Failed(failure, receipt.PublicId);
        }

        return RampOperationStartWriteResult.Failed(
            RampOperationStartWriteFailure.Conflict);
    }

    private static string ComputePayloadHash(Guid operationId)
    {
        var payload = $"v1\n{StartCommandType}\n{operationId:D}";
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

    private static RampOperationStartWriteResult Forbidden() =>
        RampOperationStartWriteResult.Failed(RampOperationStartWriteFailure.Forbidden);

    private static RampOperationStartWriteResult Conflict() =>
        RampOperationStartWriteResult.Failed(RampOperationStartWriteFailure.Conflict);

    private sealed record ActorProfile(
        long AccountInternalId,
        long RampAgentInternalId,
        Guid RampAgentPublicId);

    private sealed record OperationScope(
        Guid TurnaroundPublicId,
        DateOnly OperationDate,
        TurnaroundStatus TurnaroundStatus,
        long StationInternalId,
        long AirlineOrganizationInternalId);

    private sealed record StandScope(
        long StationInternalId,
        long? TerminalInternalId,
        bool IsActive);
}
