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

/// <summary>
/// Flight Report capture from the tablet (ADR-0031): one-tap milestones and flight data typed
/// once. Same contract as every mobile command: device-scoped idempotent receipts, a serializable
/// transaction, the assigned agent only, audit and the ramp change hints.
/// </summary>
internal sealed class EfRampExecutionCommandStore(ElevantDbContext context, TimeProvider timeProvider)
    : IRampExecutionCommandStore
{
    private const string MilestoneCommand = "ramp.operation.milestone.record.v1";
    private const string FlightDataCommand = "ramp.operation.flight_data.update.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed record Scope(RampExecutionActorAccess Actor,
        RampOperationExecutionScope Operation, MobileCommandReceipt Receipt, DateTimeOffset Now);

    public Task<RampExecutionWriteResult> RecordMilestoneAsync(RampMilestoneWriteRequest request,
        CancellationToken cancellationToken = default) =>
        RunAsync(MilestoneCommand, request.ActorAccountId, request.AllowedStationIds, request.OperationId,
            request.InstallationId, request.IdempotencyKey,
            Hash(new { command = MilestoneCommand, operationId = request.OperationId, request.Code,
                occurredAt = Truncate(request.OccurredAt) }),
            async (scope, ct) =>
            {
                var operation = scope.Operation.Operation;
                var occurredAt = Truncate(request.OccurredAt);
                if (!RampExecutionPolicy.CanRecordMilestone(scope.Operation.TurnaroundStatus, operation.CurrentStatus,
                        operation.ActualStartAt, operation.ActualEndAt, occurredAt, scope.Now))
                    return ConflictCode;
                var milestone = await context.Set<OperationMilestone>()
                    .SingleOrDefaultAsync(item => item.GroundOperationId == operation.Id && item.Code == request.Code, ct);
                var previous = milestone?.ActualAt;
                if (milestone is null)
                {
                    milestone = new OperationMilestone
                    {
                        PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, Code = request.Code,
                        CreatedAt = scope.Now,
                    };
                    context.Add(milestone);
                }
                milestone.ActualAt = occurredAt;
                milestone.Status = MilestoneStatus.Actual;
                milestone.Source = OperationalDataSource.Manual;
                milestone.UpdatedAt = scope.Now;
                Audit(scope, request.RequestId, "ramp.operation.milestone.recorded", new
                {
                    code = request.Code, occurredAt, previous, installationId = request.InstallationId,
                });
                return null;
            }, cancellationToken);

    public Task<RampExecutionWriteResult> UpdateFlightDataAsync(RampFlightDataWriteRequest request,
        CancellationToken cancellationToken = default) =>
        RunAsync(FlightDataCommand, request.ActorAccountId, request.AllowedStationIds, request.OperationId,
            request.InstallationId, request.IdempotencyKey, FlightDataHash(request),
            async (scope, ct) =>
            {
                var operation = scope.Operation.Operation;
                if (!RampExecutionPolicy.CanUpdateFlightData(scope.Operation.TurnaroundStatus, operation.CurrentStatus,
                        operation.ActualStartAt, operation.ActualEndAt))
                    return ConflictCode;
                var turnaround = await context.Turnarounds.SingleAsync(item => item.Id == operation.TurnaroundId, ct);
                // 3-B: the aircraft type the agent sees on the ramp, typed once; frozen from the first submission. The
                // tablet records what is there: the stand rules are OCC's, never a reason to refuse the agent.
                long? previousType = turnaround.AircraftTypeId;
                if (request.AircraftTypeId is { } typeId)
                {
                    var type = await context.AircraftTypes.AsNoTracking().Where(item => item.PublicId == typeId)
                        .Select(item => new { item.Id, item.IsActive }).SingleOrDefaultAsync(ct);
                    if (type is null || (!type.IsActive && type.Id != turnaround.AircraftTypeId))
                        return RampExecutionCodes.AircraftTypeUnavailable;
                    if (type.Id != turnaround.AircraftTypeId)
                    {
                        if (await context.OperationSubmissions.AsNoTracking()
                                .AnyAsync(item => item.GroundOperationId == operation.Id, ct))
                            return RampExecutionCodes.AircraftTypeLocked;
                        turnaround.AircraftTypeId = type.Id;
                        turnaround.UpdatedAt = scope.Now;
                    }
                }
                var before = new { operation.PassengersIn, operation.PassengersOut, operation.MtowKg };
                operation.PassengersIn = request.PassengersIn;
                operation.PassengersOut = request.PassengersOut;
                operation.MtowKg = request.MtowKg;
                operation.UpdatedAt = scope.Now;
                string? previousRegistration = null;
                if (request.AircraftRegistration is not null)
                {
                    // Corrected once on the ramp, it propagates to the turnaround and every form.
                    previousRegistration = turnaround.AircraftRegistration;
                    if (!string.Equals(previousRegistration, request.AircraftRegistration, StringComparison.Ordinal))
                    {
                        turnaround.AircraftRegistration = request.AircraftRegistration;
                        turnaround.UpdatedAt = scope.Now;
                    }
                }
                Audit(scope, request.RequestId, "ramp.operation.flight_data.updated", new
                {
                    before, request.PassengersIn, request.PassengersOut, request.MtowKg,
                    registration = request.AircraftRegistration, previousRegistration, installationId = request.InstallationId,
                    aircraftTypeId = request.AircraftTypeId, previousAircraftTypeId = previousType,
                    currentAircraftTypeId = turnaround.AircraftTypeId,
                });
                return null;
            }, cancellationToken);

    /// <summary>
    /// The receipt hash of a flight-data command. Without an aircraft type the canonical payload is byte for byte the
    /// one of the first version, so a command the deployed APK queued offline replays instead of conflicting (3-B).
    /// </summary>
    internal static string FlightDataHash(RampFlightDataWriteRequest request) => request.AircraftTypeId is { } typeId
        ? Hash(new { command = FlightDataCommand, operationId = request.OperationId, request.PassengersIn,
            request.PassengersOut, request.MtowKg, request.AircraftRegistration, aircraftTypeId = typeId })
        : Hash(new { command = FlightDataCommand, operationId = request.OperationId, request.PassengersIn,
            request.PassengersOut, request.MtowKg, request.AircraftRegistration });

    /// <summary>The receipt code of a refused command whose cause the tablet does not act on.</summary>
    private const string ConflictCode = "conflict";

    /// <summary>
    /// Runs one device-scoped command; <paramref name="apply"/> is its work, which answers null when it applied and
    /// otherwise the code of the rejection the receipt keeps.
    /// </summary>
    private async Task<RampExecutionWriteResult> RunAsync(string commandType, Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid operationId, Guid installationId, Guid idempotencyKey, string payloadHash,
        Func<Scope, CancellationToken, Task<string?>> apply, CancellationToken cancellationToken)
    {
        RampExecutionWriteResult? attempt = null;
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                async ct =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await InsideAsync(commandType, accountId, stations, operationId, installationId,
                        idempotencyKey, payloadHash, apply, ct);
                    if (attempt.CommitReceiptId is null) context.ChangeTracker.Clear();
                    return attempt;
                },
                async ct =>
                {
                    context.ChangeTracker.Clear();
                    return attempt?.CommitReceiptId is not Guid receiptId
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
            return RampExecutionWriteResult.Failed(RampExecutionWriteFailure.Conflict);
        }
    }

    private async Task<RampExecutionWriteResult> InsideAsync(string commandType, Guid accountId,
        IReadOnlyCollection<Guid> stations, Guid operationId, Guid installationId, Guid idempotencyKey, string payloadHash,
        Func<Scope, CancellationToken, Task<string?>> apply, CancellationToken cancellationToken)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actorResult = await authorization.ResolveActorAsync(accountId, stations, installationId, cancellationToken);
        if (!actorResult.IsSuccess)
            return RampExecutionWriteResult.Failed(actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                ? RampExecutionWriteFailure.Forbidden : RampExecutionWriteFailure.NotFound);
        var actor = actorResult.Access!;
        var device = actor.Device!;
        var now = Truncate(timeProvider.GetUtcNow());
        var key = idempotencyKey.ToString("D");
        var existing = await context.MobileCommandReceipts.FromSqlInterpolated($"""
                SELECT * FROM [integration].[mobile_command_receipts] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id} AND [idempotency_key] = {key}
                """).SingleOrDefaultAsync(cancellationToken);
        if (existing is not null) return Replay(existing, commandType, actor.AccountInternalId, payloadHash);

        var receipt = new MobileCommandReceipt
        {
            PublicId = Guid.CreateVersion7(), MobileDeviceId = device.Id, AccountId = actor.AccountInternalId,
            IdempotencyKey = key, CommandType = commandType, PayloadHash = payloadHash, Status = MobileCommandStatus.Received,
            ReceivedAt = now, ExpiresAt = now.Add(ReceiptRetention), CreatedAt = now, UpdatedAt = now,
        };
        context.MobileCommandReceipts.Add(receipt);
        var operation = await authorization.ResolveOperationAsync(actor, operationId, lockForUpdate: true, cancellationToken);
        if (operation is null) return await RejectAsync(receipt, "not_found", now, cancellationToken);

        var scope = new Scope(actor, operation, receipt, now);
        if (await apply(scope, cancellationToken) is { } rejection)
            return await RejectAsync(receipt, rejection, now, cancellationToken);
        await RampOperationChangeWriter.AnnounceAsync(context, operation.Operation.Id, now, false, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        var data = await SnapshotAsync(receipt.PublicId, operation.Operation.Id, operation.Operation.PublicId, cancellationToken);
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(data, Json);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampExecutionWriteResult.Success(data, receipt.PublicId);
    }

    private async Task<RampExecutionData> SnapshotAsync(Guid receiptId, long operationId, Guid operationPublicId,
        CancellationToken cancellationToken)
    {
        var milestones = await context.Set<OperationMilestone>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId && item.ActualAt != null)
            .Select(item => new { item.Code, item.ActualAt }).ToArrayAsync(cancellationToken);
        var flight = await (from operation in context.GroundOperations.AsNoTracking()
                            join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                            where operation.Id == operationId
                            select new { operation.PassengersIn, operation.PassengersOut, operation.MtowKg,
                                turnaround.AircraftRegistration }).SingleAsync(cancellationToken);
        var order = FlightReportMilestones.All.ToDictionary(item => item.Code, item => item.SortOrder);
        return new RampExecutionData(receiptId, operationPublicId,
            milestones.OrderBy(item => order.GetValueOrDefault(item.Code, int.MaxValue))
                .Select(item => new RampMilestoneData(item.Code, item.ActualAt!.Value)).ToArray(),
            new RampFlightData(flight.PassengersIn, flight.PassengersOut, flight.MtowKg), flight.AircraftRegistration);
    }

    private void Audit(Scope scope, string? requestId, string action, object metadata) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = scope.Now, ActorType = AuditActorType.Account,
            ActorAccountId = scope.Actor.AccountInternalId, ActorDisplay = scope.Actor.DisplayName, Action = action,
            EntityType = nameof(GroundOperation), EntityPublicId = scope.Operation.Operation.PublicId,
            OrganizationId = scope.Operation.AirlineOrganizationInternalId, StationId = scope.Operation.StationInternalId,
            Source = AuditSource.MobileSync, CorrelationId = Guid.CreateVersion7(), RequestId = requestId,
            Reason = "Assigned ramp agent recorded the Flight Report.",
            MetadataJson = JsonSerializer.Serialize(metadata, Json),
        });

    private async Task<RampExecutionWriteResult> RejectAsync(MobileCommandReceipt receipt, string errorCode,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        context.ChangeTracker.Entries().Where(entry => entry.Entity != receipt && entry.State != EntityState.Unchanged)
            .ToList().ForEach(entry => entry.State = entry.State == EntityState.Added ? EntityState.Detached : EntityState.Unchanged);
        receipt.Status = MobileCommandStatus.Rejected;
        receipt.ProcessedAt = now;
        receipt.ErrorCode = errorCode;
        receipt.ErrorMessage = errorCode switch
        {
            "not_found" => "The ramp operation was not found.",
            RampExecutionCodes.AircraftTypeUnavailable => "The aircraft type is not available.",
            RampExecutionCodes.AircraftTypeLocked => "The aircraft type is locked since the first submission.",
            _ => "The Flight Report entry conflicts with the operation.",
        };
        receipt.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampExecutionWriteResult.Failed(errorCode == "not_found"
            ? RampExecutionWriteFailure.NotFound : RampExecutionWriteFailure.Conflict, receipt.PublicId, errorCode);
    }

    private static RampExecutionWriteResult Replay(MobileCommandReceipt receipt, string commandType, long accountId,
        string payloadHash)
    {
        if (receipt.AccountId != accountId || receipt.CommandType != commandType || receipt.PayloadHash != payloadHash)
            return RampExecutionWriteResult.Failed(RampExecutionWriteFailure.IdempotencyKeyConflict);
        if (receipt.Status == MobileCommandStatus.Processed && !string.IsNullOrWhiteSpace(receipt.ResultJson))
            return RampExecutionWriteResult.Success(JsonSerializer.Deserialize<RampExecutionData>(receipt.ResultJson, Json)
                ?? throw new InvalidOperationException("The stored Flight Report result is invalid."), receipt.PublicId);
        if (receipt.Status == MobileCommandStatus.Rejected)
            return RampExecutionWriteResult.Failed(receipt.ErrorCode == "not_found"
                ? RampExecutionWriteFailure.NotFound : RampExecutionWriteFailure.Conflict, receipt.PublicId, receipt.ErrorCode);
        return RampExecutionWriteResult.Failed(RampExecutionWriteFailure.Conflict);
    }

    private static string Hash(object canonical) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(canonical, Json))))
            .ToLowerInvariant();

    private static DateTimeOffset Truncate(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }
}
