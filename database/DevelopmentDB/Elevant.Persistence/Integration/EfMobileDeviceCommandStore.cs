using System.Data;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Integration;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Integration;

/// <summary>Owns fail-closed registration of a mobile installation to one account.</summary>
internal sealed class EfMobileDeviceCommandStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IMobileDeviceCommandStore
{
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
            await context.SaveChangesAsync(cancellationToken);

            return Success(device, now);
        }

        if (device.RevokedAt is not null)
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
        if (binding is null || binding.AccountId != accountInternalId.Value)
        {
            return Forbidden();
        }

        if (device.Platform != request.Platform)
        {
            return Conflict();
        }

        device.DeviceName = request.DeviceName;
        device.AppVersion = request.AppVersion;
        device.OperatingSystemVersion = request.OperatingSystemVersion;
        device.LastSeenAt = now;
        device.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);

        return Success(device, now);
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

    private static MobileDeviceRegistrationWriteResult Forbidden() =>
        MobileDeviceRegistrationWriteResult.Failed(
            MobileDeviceRegistrationWriteFailure.Forbidden);

    private static MobileDeviceRegistrationWriteResult Conflict() =>
        MobileDeviceRegistrationWriteResult.Failed(
            MobileDeviceRegistrationWriteFailure.Conflict);
}
