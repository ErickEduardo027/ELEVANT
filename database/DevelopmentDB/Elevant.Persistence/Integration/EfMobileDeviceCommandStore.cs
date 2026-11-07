using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Integration;

/// <summary>
/// Owns fail-closed registration of a mobile installation to one account. A shared tablet passes to the next
/// agent who signs in on it unless the agent holding it has an operation in progress (2-N02); a revoked
/// installation never registers again. Signing out releases the tablet.
/// </summary>
internal sealed class EfMobileDeviceCommandStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IMobileDeviceCommandStore
{
    private const string ReleaseCommand = "mobile_device.release";
    private static readonly TimeSpan ReceiptRetention = TimeSpan.FromDays(30);

    public async Task<MobileDeviceRegistrationWriteResult> RegisterAsync(
        MobileDeviceRegistrationWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var strategy = context.Database.CreateExecutionStrategy();
        MobileDeviceRegistrationWriteResult? attemptResult = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async operationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    attemptResult = await RegisterInsideTransactionAsync(
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
                    if (attemptResult?.CommitReceiptId is not Guid deviceId ||
                        attemptResult.Device is not MobileDeviceRegistrationData expected)
                    {
                        return attemptResult is not null;
                    }

                    return await (
                            from device in context.MobileDevices.AsNoTracking()
                            join binding in context.Set<MobileDeviceAccountBinding>().AsNoTracking()
                                on device.Id equals binding.MobileDeviceId
                            join account in context.Users.AsNoTracking()
                                on binding.AccountId equals account.Id
                            where device.PublicId == deviceId &&
                                  device.InstallationId == request.InstallationId &&
                                  device.Platform == request.Platform &&
                                  device.DeviceName == request.DeviceName &&
                                  device.AppVersion == request.AppVersion &&
                                  device.OperatingSystemVersion == request.OperatingSystemVersion &&
                                  device.LastSeenAt == expected.LastSeenAt &&
                                  device.RevokedAt == null &&
                                  binding.UnboundAt == null &&
                                  account.PublicId == request.ActorAccountId
                            select device.Id)
                        .AnyAsync(verificationCancellationToken);
                },
                IsolationLevel.Serializable,
                cancellationToken);
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

    private async Task<MobileDeviceRegistrationWriteResult> RegisterInsideTransactionAsync(
        MobileDeviceRegistrationWriteRequest request,
        CancellationToken cancellationToken)
    {
        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (liveActor is null ||
            liveActor.AccountId != request.ActorAccountId ||
            !RampOperationsAccess.IsAuthorized(liveActor))
        {
            return Forbidden();
        }

        var accountInternalId = await context.Users
            .AsNoTracking()
            .Where(account => account.PublicId == request.ActorAccountId)
            .Select(account => (long?)account.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (accountInternalId is null)
        {
            return Forbidden();
        }

        var activeRampProfiles = await (
                from account in context.Users.AsNoTracking()
                join agent in context.RampAgents.AsNoTracking()
                    on account.PersonId equals agent.PersonId
                where account.Id == accountInternalId.Value && agent.IsActive
                select agent.Id)
            .Take(2)
            .ToArrayAsync(cancellationToken);
        if (activeRampProfiles.Length != 1)
        {
            return Forbidden();
        }

        var device = await context.MobileDevices
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_devices] WITH (UPDLOCK, HOLDLOCK)
                WHERE [installation_id] = {request.InstallationId}
                """)
            .SingleOrDefaultAsync(cancellationToken);

        if (device is null)
        {
            device = new MobileDevice
            {
                PublicId = Guid.CreateVersion7(),
                InstallationId = request.InstallationId,
                Platform = request.Platform,
                DeviceName = request.DeviceName,
                AppVersion = request.AppVersion,
                OperatingSystemVersion = request.OperatingSystemVersion,
                LastSeenAt = now,
                CreatedAt = now,
                UpdatedAt = now,
            };
            context.MobileDevices.Add(device);
            await context.SaveChangesAsync(cancellationToken);

            context.Set<MobileDeviceAccountBinding>().Add(new MobileDeviceAccountBinding
            {
                MobileDeviceId = device.Id,
                AccountId = accountInternalId.Value,
                BoundAt = now,
            });
            await MobileDeviceBindings.AnnounceAsync(context, [device.PublicId], now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            return Success(device, now);
        }

        if (device.RevokedAt is not null)
        {
            return Forbidden(MobileDeviceCodes.Revoked);
        }

        if (device.Platform != request.Platform)
        {
            return Conflict(MobileDeviceCodes.PlatformMismatch);
        }

        var binding = await context.Set<MobileDeviceAccountBinding>()
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_device_account_bindings] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id}
                  AND [unbound_at] IS NULL
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (binding is not null && binding.AccountId != accountInternalId.Value)
        {
            // 2-N02: a shared tablet passes to the agent who signs in on it, unless the agent holding it is in the
            // middle of an operation (OCC can still free it from its tablet screen).
            if (await MobileDeviceBindings.HasOperationInProgressAsync(context, binding.AccountId, cancellationToken))
            {
                return Conflict(MobileDeviceCodes.InUseByActiveAgent);
            }

            var previous = await context.Users.AsNoTracking()
                .Where(account => account.Id == binding.AccountId)
                .Select(account => account.PublicId)
                .SingleAsync(cancellationToken);
            MobileDeviceBindings.Close(binding, now);
            // The filtered unique index keeps one open binding per tablet: the old one closes first.
            await context.SaveChangesAsync(cancellationToken);
            MobileDeviceBindings.Audit(context, accountInternalId.Value, "mobile_device.binding_taken_over",
                device.PublicId, null, AuditSource.MobileSync, now,
                new AuditFieldChangeData("binding.account", previous.ToString("D"),
                    request.ActorAccountId.ToString("D")));
            binding = null;
        }

        var bound = binding is null;
        if (bound)
        {
            // Released (sign-out, OCC, the end of the previous agent's ramp duty) or just taken over.
            context.Set<MobileDeviceAccountBinding>().Add(new MobileDeviceAccountBinding
            {
                MobileDeviceId = device.Id,
                AccountId = accountInternalId.Value,
                BoundAt = now,
            });
        }

        device.DeviceName = request.DeviceName;
        device.AppVersion = request.AppVersion;
        device.OperatingSystemVersion = request.OperatingSystemVersion;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        if (bound)
        {
            await MobileDeviceBindings.AnnounceAsync(context, [device.PublicId], now, cancellationToken);
        }

        await context.SaveChangesAsync(cancellationToken);

        return Success(device, now);
    }

    public async Task<MobileDeviceReleaseWriteResult> ReleaseAsync(
        MobileDeviceReleaseWriteRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.ActorAccountId == Guid.Empty)
        {
            return MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.Forbidden, "forbidden");
        }

        var strategy = context.Database.CreateExecutionStrategy();
        Guid? committedReceipt = null;
        MobileDeviceReleaseWriteResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async operationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    committedReceipt = null;
                    attempt = await ReleaseInsideTransactionAsync(request, receipt => committedReceipt = receipt,
                        operationCancellationToken);
                    if (committedReceipt is null)
                    {
                        context.ChangeTracker.Clear();
                    }

                    return attempt;
                },
                async verificationCancellationToken =>
                {
                    context.ChangeTracker.Clear();
                    return committedReceipt is not Guid receiptId
                        ? attempt is not null
                        : await context.MobileCommandReceipts.AsNoTracking()
                            .AnyAsync(item => item.PublicId == receiptId, verificationCancellationToken);
                },
                IsolationLevel.Serializable,
                cancellationToken);
        }
        catch (Exception exception) when (exception is DbUpdateConcurrencyException ||
            (exception is RetryLimitExceededException or DbUpdateException or SqlException &&
             exception.GetBaseException() is SqlException { Number: 1205 or 1222 or 3960 or 2601 or 2627 or 547 }))
        {
            context.ChangeTracker.Clear();
            return MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.Conflict, "version_conflict");
        }
    }

    private async Task<MobileDeviceReleaseWriteResult> ReleaseInsideTransactionAsync(
        MobileDeviceReleaseWriteRequest request,
        Action<Guid> committed,
        CancellationToken cancellationToken)
    {
        var now = NormalizeToMilliseconds(timeProvider.GetUtcNow());
        var liveActor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(request.ActorAccountId, cancellationToken);
        if (liveActor is null || liveActor.AccountId != request.ActorAccountId)
        {
            return MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.Forbidden, "forbidden");
        }

        var accountId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == request.ActorAccountId)
            .Select(account => account.Id)
            .SingleAsync(cancellationToken);
        var device = await context.MobileDevices
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_devices] WITH (UPDLOCK, HOLDLOCK)
                WHERE [installation_id] = {request.InstallationId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (device is null)
        {
            return MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.NotFound, "not_found");
        }

        var key = request.IdempotencyKey.ToString("D");
        var hash = RampReceiptRunner.Hash(new { installationId = request.InstallationId });
        var existing = await context.MobileCommandReceipts.FromSqlInterpolated($"""
                SELECT * FROM [integration].[mobile_command_receipts] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id} AND [idempotency_key] = {key}
                """).SingleOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            if (existing.AccountId != accountId || existing.CommandType != ReleaseCommand ||
                existing.PayloadHash != hash)
            {
                return MobileDeviceReleaseWriteResult.Failed(
                    MobileDeviceReleaseWriteFailure.IdempotencyKeyConflict, "idempotency_conflict");
            }

            return existing.Status == MobileCommandStatus.Processed
                ? MobileDeviceReleaseWriteResult.Released()
                : MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.Conflict,
                    existing.ErrorCode ?? MobileDeviceCodes.NotBound);
        }

        if (device.RevokedAt is not null)
        {
            return MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.Forbidden,
                MobileDeviceCodes.Revoked);
        }

        var receipt = new MobileCommandReceipt
        {
            PublicId = Guid.CreateVersion7(), MobileDeviceId = device.Id, AccountId = accountId,
            IdempotencyKey = key, CommandType = ReleaseCommand, PayloadHash = hash,
            Status = MobileCommandStatus.Received, ReceivedAt = now, ExpiresAt = now.Add(ReceiptRetention),
            CreatedAt = now, UpdatedAt = now,
        };
        context.MobileCommandReceipts.Add(receipt);
        var binding = await context.Set<MobileDeviceAccountBinding>()
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_device_account_bindings] WITH (UPDLOCK, HOLDLOCK)
                WHERE [mobile_device_id] = {device.Id}
                  AND [unbound_at] IS NULL
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (binding is null || binding.AccountId != accountId)
        {
            // Another agent took the tablet, OCC freed it or this agent's duty ended: nothing to release. The
            // refusal is kept, so a retry with the same key answers the same.
            receipt.Status = MobileCommandStatus.Rejected;
            receipt.ProcessedAt = now;
            receipt.ErrorCode = MobileDeviceCodes.NotBound;
            receipt.ErrorMessage = "The tablet is not bound to this account.";
            await context.SaveChangesAsync(cancellationToken);
            committed(receipt.PublicId);
            return MobileDeviceReleaseWriteResult.Failed(MobileDeviceReleaseWriteFailure.Conflict,
                MobileDeviceCodes.NotBound);
        }

        MobileDeviceBindings.Close(binding, now);
        MobileDeviceBindings.Audit(context, accountId, "mobile_device.binding_released", device.PublicId, null,
            AuditSource.MobileSync, now,
            new AuditFieldChangeData("binding.account", request.ActorAccountId.ToString("D"), null));
        await MobileDeviceBindings.AnnounceAsync(context, [device.PublicId], now, cancellationToken);
        receipt.Status = MobileCommandStatus.Processed;
        receipt.ProcessedAt = now;
        receipt.ResultJson = JsonSerializer.Serialize(new { released = true });
        receipt.UpdatedAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);
        committed(receipt.PublicId);
        return MobileDeviceReleaseWriteResult.Released();
    }

    private static MobileDeviceRegistrationWriteResult Success(
        MobileDevice device,
        DateTimeOffset lastSeenAt) =>
        MobileDeviceRegistrationWriteResult.Success(
            new MobileDeviceRegistrationData(
                device.InstallationId,
                device.Platform.ToString(),
                device.AppVersion,
                lastSeenAt),
            device.PublicId);

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

    private static MobileDeviceRegistrationWriteResult Forbidden(string? code = null) =>
        MobileDeviceRegistrationWriteResult.Failed(
            MobileDeviceRegistrationWriteFailure.Forbidden, code);

    private static MobileDeviceRegistrationWriteResult Conflict(string? code = null) =>
        MobileDeviceRegistrationWriteResult.Failed(
            MobileDeviceRegistrationWriteFailure.Conflict, code);
}
