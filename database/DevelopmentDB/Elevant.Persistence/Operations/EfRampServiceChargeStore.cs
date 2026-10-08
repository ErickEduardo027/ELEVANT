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

/// <summary>
/// Charges ramp agents mark on their executed services. Each mark is a device-scoped,
/// idempotent command; the agent never sees a price.
/// </summary>
internal sealed class EfRampServiceChargeStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IRampServiceChargeStore
{
    private const string CommandType = "ramp.operation.service.charge.v1";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<RampOperationChargesData?> ReadAsync(Guid accountId, IReadOnlyList<Guid> allowedStationIds,
        Guid operationId, Guid installationId, CancellationToken cancellationToken = default)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actor = await authorization.ResolveActorAsync(accountId, allowedStationIds.ToArray(), installationId,
            cancellationToken);
        if (!actor.IsSuccess) return null;
        var scope = await authorization.ResolveOperationAsync(actor.Access!, operationId, lockForUpdate: false,
            cancellationToken);
        if (scope is null) return null;
        var services = await context.OperationServices.AsNoTracking()
            .Where(service => service.GroundOperationId == scope.Operation.Id)
            .OrderBy(service => service.LineNumber).ToArrayAsync(cancellationToken);
        var charges = new List<RampServiceChargesData>();
        foreach (var service in services)
            charges.Add(await ServiceChargesAsync(service, scope, cancellationToken));
        return new RampOperationChargesData(scope.Operation.PublicId, charges);
    }

    /// <summary>Active agent-visible charges in scope for the service, minus those the contract excludes.</summary>
    private async Task<RampServiceChargesData> ServiceChargesAsync(OperationService service,
        RampOperationExecutionScope scope, CancellationToken cancellationToken)
    {
        var excluded = await (from rate in context.ContractServiceRates.AsNoTracking()
                              join exclusion in context.ContractChargeRates.AsNoTracking()
                                  on rate.ContractVersionId equals exclusion.ContractVersionId
                              where rate.Id == service.ContractServiceRateId && exclusion.IsExcluded
                              select exclusion.ChargeDefinitionId).ToArrayAsync(cancellationToken);
        var available = await context.ChargeDefinitions.AsNoTracking()
            .Where(charge => charge.IsActive && charge.VisibleToAgents && !excluded.Contains(charge.Id) &&
                (charge.AppliesToAllServices || context.ChargeDefinitionServices.Any(link =>
                    link.ChargeDefinitionId == charge.Id && link.ServiceDefinitionId == service.ServiceDefinitionId)))
            .OrderBy(charge => charge.Category).ThenBy(charge => charge.Name)
            .Select(charge => new RampChargeOptionData(charge.PublicId, charge.Code, charge.Name, charge.Description,
                charge.Category.ToString(), charge.AllowMultiple))
            .ToArrayAsync(cancellationToken);
        var applied = await (from mark in context.OperationServiceCharges.AsNoTracking()
                             join charge in context.ChargeDefinitions.AsNoTracking() on mark.ChargeDefinitionId equals charge.Id
                             where mark.OperationServiceId == service.Id && mark.RemovedAt == null
                             orderby mark.AppliedAt
                             select new RampAppliedChargeData(mark.PublicId, charge.PublicId, charge.Code, charge.Name,
                                 mark.AppliedAt)).ToArrayAsync(cancellationToken);
        var canEdit = RampServiceChargePolicy.CanEdit(scope.TurnaroundStatus, scope.Operation.CurrentStatus,
            scope.Operation.ActualStartAt, scope.Operation.ActualEndAt, service.CurrentStatus);
        return new RampServiceChargesData(service.PublicId, canEdit, available, applied);
    }

    public async Task<RampServiceChargeWriteResult> ApplyAsync(RampServiceChargeWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        RampServiceChargeWriteResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await ApplyInsideTransactionAsync(request, token);
                    if (attempt.CommitReceiptId is null) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    if (attempt?.CommitReceiptId is not Guid receiptId) return attempt is not null;
                    return await context.MobileCommandReceipts.AsNoTracking()
                        .AnyAsync(receipt => receipt.PublicId == receiptId, token);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (Exception exception) when (exception is DbUpdateException or RetryLimitExceededException or SqlException &&
                                          exception.GetBaseException() is SqlException { Number: 1205 or 1222 or 3960 or 2601 or 2627 or 547 })
        {
            context.ChangeTracker.Clear();
            return RampServiceChargeWriteResult.Failed(RampOperationServiceTransitionWriteFailure.Conflict);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return RampServiceChargeWriteResult.Failed(RampOperationServiceTransitionWriteFailure.Conflict);
        }
    }

    private async Task<RampServiceChargeWriteResult> ApplyInsideTransactionAsync(RampServiceChargeWriteRequest request,
        CancellationToken cancellationToken)
    {
        var authorization = new EfRampExecutionAuthorization(context, timeProvider);
        var actorResult = await authorization.ResolveActorAsync(request.ActorAccountId, request.AllowedStationIds.ToArray(),
            request.InstallationId, cancellationToken);
        if (!actorResult.IsSuccess)
            return RampServiceChargeWriteResult.Failed(actorResult.Failure == RampExecutionAuthorizationFailure.Forbidden
                ? RampOperationServiceTransitionWriteFailure.Forbidden
                : RampOperationServiceTransitionWriteFailure.NotFound);
        var actor = actorResult.Access!;
        var device = actor.Device!;
        var now = Normalize(timeProvider.GetUtcNow());
        var idempotencyKey = request.IdempotencyKey.ToString("D");
        var payloadHash = PayloadHash(request);
        var existing = await context.MobileCommandReceipts
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_command_receipts] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id}
                  AND [idempotency_key] = {idempotencyKey}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (existing is not null) return Replay(existing, actor.AccountInternalId, payloadHash);

        var receipt = new MobileCommandReceipt
        {
            PublicId = Guid.CreateVersion7(), MobileDeviceId = device.Id, AccountId = actor.AccountInternalId,
            IdempotencyKey = idempotencyKey, CommandType = CommandType, PayloadHash = payloadHash,
            Status = MobileCommandStatus.Received, ReceivedAt = now, ExpiresAt = now.Add(ReceiptRetention),
            CreatedAt = now, UpdatedAt = now,
        };
        context.MobileCommandReceipts.Add(receipt);

        var scope = await authorization.ResolveOperationAsync(actor, request.OperationId, lockForUpdate: true,
            cancellationToken);
        var service = scope is null ? null : await context.OperationServices
            .FromSqlInterpolated($"""
                SELECT *
                FROM [ops].[operation_services] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {request.ServiceId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null || service is null || service.GroundOperationId != scope.Operation.Id)
            return await RejectAsync(receipt, RampOperationServiceTransitionWriteFailure.NotFound, "not_found", now,
                cancellationToken);

        var options = await ServiceChargesAsync(service, scope, cancellationToken);
        var option = options.Available.SingleOrDefault(item => item.Id == request.ChargeId);
        var applied = options.Applied.Where(item => item.ChargeId == request.ChargeId).ToArray();
        var allowed = options.CanEdit && request.Action switch
        {
            RampServiceChargeAction.Apply => option is not null && (option.AllowMultiple || applied.Length == 0),
            RampServiceChargeAction.Remove => applied.Length > 0,
            _ => false,
        };
        if (!allowed)
            return await RejectAsync(receipt, RampOperationServiceTransitionWriteFailure.Conflict, "conflict", now,
                cancellationToken);

        var chargeInternalId = await context.ChargeDefinitions.AsNoTracking()
            .Where(charge => charge.PublicId == request.ChargeId).Select(charge => charge.Id)
            .SingleAsync(cancellationToken);
        Guid markId;
        if (request.Action == RampServiceChargeAction.Apply)
        {
            var mark = new OperationServiceCharge
            {
                PublicId = Guid.CreateVersion7(), OperationServiceId = service.Id, ChargeDefinitionId = chargeInternalId,
                AppliedByRampAgentId = actor.RampAgentInternalId, AppliedAt = now, CreatedAt = now, UpdatedAt = now,
            };
            context.OperationServiceCharges.Add(mark);
            markId = mark.PublicId;
        }
        else
        {
            var latest = applied.Last().Id;
            var mark = await context.OperationServiceCharges.SingleAsync(item => item.PublicId == latest, cancellationToken);
            mark.RemovedAt = now;
            mark.RemovedByRampAgentId = actor.RampAgentInternalId;
            mark.UpdatedAt = now;
            markId = mark.PublicId;
        }
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = actor.AccountInternalId, ActorDisplay = actor.DisplayName,
            Action = request.Action == RampServiceChargeAction.Apply
                ? "ramp.operation.service.charge_applied" : "ramp.operation.service.charge_removed",
            EntityType = nameof(OperationServiceCharge), EntityPublicId = markId,
            OrganizationId = scope.AirlineOrganizationInternalId, StationId = scope.StationInternalId,
            Source = AuditSource.MobileSync, CorrelationId = request.CorrelationId, RequestId = request.RequestId,
            Reason = "Assigned ramp agent marked a billable charge.",
            MetadataJson = JsonSerializer.Serialize(new
            {
                operationId = scope.Operation.PublicId, serviceId = service.PublicId, chargeId = request.ChargeId,
                installationId = device.InstallationId,
            }, JsonOptions),
        });
        await context.SaveChangesAsync(cancellationToken);

        var data = new RampServiceChargeCommandData(receipt.PublicId,
            await ServiceChargesAsync(service, scope, cancellationToken));
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(data, JsonOptions);
        receipt.UpdatedAt = now;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampServiceChargeWriteResult.Success(data, receipt.PublicId);
    }

    private async Task<RampServiceChargeWriteResult> RejectAsync(MobileCommandReceipt receipt,
        RampOperationServiceTransitionWriteFailure failure, string errorCode, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        receipt.Status = MobileCommandStatus.Rejected;
        receipt.ProcessedAt = now;
        receipt.ErrorCode = errorCode;
        receipt.ErrorMessage = errorCode == "not_found"
            ? "The ramp operation or service was not found."
            : "The charge conflicts with the current state of the service.";
        receipt.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        return RampServiceChargeWriteResult.Failed(failure, receipt.PublicId);
    }

    private static RampServiceChargeWriteResult Replay(MobileCommandReceipt receipt, long accountId, string payloadHash)
    {
        if (receipt.AccountId != accountId || receipt.CommandType != CommandType || receipt.PayloadHash != payloadHash)
            return RampServiceChargeWriteResult.Failed(RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict);
        if (receipt.Status == MobileCommandStatus.Processed && !string.IsNullOrWhiteSpace(receipt.ResultJson))
            return RampServiceChargeWriteResult.Success(
                JsonSerializer.Deserialize<RampServiceChargeCommandData>(receipt.ResultJson, JsonOptions)!,
                receipt.PublicId);
        if (receipt.Status == MobileCommandStatus.Rejected)
            return RampServiceChargeWriteResult.Failed(receipt.ErrorCode == "not_found"
                ? RampOperationServiceTransitionWriteFailure.NotFound
                : RampOperationServiceTransitionWriteFailure.Conflict, receipt.PublicId);
        return RampServiceChargeWriteResult.Failed(RampOperationServiceTransitionWriteFailure.Conflict);
    }

    private static string PayloadHash(RampServiceChargeWriteRequest request)
    {
        var payload = JsonSerializer.Serialize(new
        {
            command = CommandType,
            operationId = request.OperationId.ToString("D"),
            serviceId = request.ServiceId.ToString("D"),
            chargeId = request.ChargeId.ToString("D"),
            action = request.Action.ToString(),
        }, JsonOptions);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    private static DateTimeOffset Normalize(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }
}
