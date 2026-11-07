using System.Data;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>
/// OCC's tablet screen (2-N02) under <c>operations.devices.*</c>. A tablet is visible when the agent who holds it,
/// or held it last, works or worked at one of the actor's stations. Freeing a tablet closes its binding; revoking a
/// lost one also blocks the installation for good and ends the sessions of the account that held it last, unless
/// that agent signed out of it (the sign-out already took the session off the tablet). Every command
/// runs serializable with an Idempotency-Key receipt (<see cref="CommercialCommandReceipts"/>) and the binding token
/// on screen (<see cref="MobileDeviceBindingToken"/>); nothing is deleted and everything is audited.
/// </summary>
internal sealed class EfMobileDeviceAdministrationStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IMobileDeviceAdministrationStore
{
    private const string UnbindAction = "occ.device.unbind";
    private const string RevokeAction = "occ.device.revoke";

    private sealed record Target(MobileDevice Device, MobileDeviceAccountBinding Binding);

    private readonly record struct Step(Guid ResultId, MobileDeviceAdministrationFailure? Failure, string? Code)
    {
        public static Step Done(Guid id) => new(id, null, null);

        public static Step Fail(MobileDeviceAdministrationFailure failure, string code) => new(Guid.Empty, failure, code);
    }

    public async Task<MobileDeviceAdministrationResult<OccMobileDevicesData>> ListAsync(Guid actorId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, MobileDeviceBindings.ReadPermission))
            return MobileDeviceAdministrationResult.Failed<OccMobileDevicesData>(MobileDeviceAdministrationFailure.Forbidden,
                "forbidden");
        var station = actor!.StationScopes.Any(scope => scope.StationId == stationId)
            ? await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId && item.IsActive)
                .Select(item => new { item.Id, item.PublicId, item.Code }).SingleOrDefaultAsync(cancellationToken)
            : null;
        if (station is null)
            return MobileDeviceAdministrationResult.Failed<OccMobileDevicesData>(MobileDeviceAdministrationFailure.NotFound,
                "not_found");
        var accounts = await StationAccountsAsync([station.Id], cancellationToken);
        var latest = await LatestBindings().Where(binding => accounts.Contains(binding.AccountId))
            .ToArrayAsync(cancellationToken);
        var items = await ItemsAsync(latest, cancellationToken);
        return MobileDeviceAdministrationResult.Success<OccMobileDevicesData>(new OccMobileDevicesData(station.PublicId,
            station.Code, actor.HasPermission(MobileDeviceBindings.UnbindPermission),
            actor.HasPermission(MobileDeviceBindings.RevokePermission), items));
    }

    public async Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> UnbindAsync(Guid actorId, Guid deviceId,
        UnbindMobileDeviceInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, MobileDeviceBindings.UnbindPermission)) return Failed(MobileDeviceAdministrationFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(MobileDeviceAdministrationFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input?.ExpectedVersion))
            return Failed(MobileDeviceAdministrationFailure.Invalid, "expected_version_required");
        var reason = string.IsNullOrWhiteSpace(input.Reason) ? null : input.Reason.Trim();
        if (reason is not null && !ContractLifecycle.ValidReason(reason))
            return Failed(MobileDeviceAdministrationFailure.Invalid, "reason_required");
        var stations = await ActorStationsAsync(actor!, cancellationToken);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { deviceId, expected = input.ExpectedVersion, reason });
        return await RunAsync(idempotencyKey, accountId, UnbindAction, hash, async now =>
        {
            if (await TargetAsync(deviceId, stations, cancellationToken) is not { } target)
                return Step.Fail(MobileDeviceAdministrationFailure.NotFound, "not_found");
            if (Token(target) != input.ExpectedVersion) return Step.Fail(MobileDeviceAdministrationFailure.Conflict, "version_conflict");
            if (target.Device.RevokedAt is not null)
                return Step.Fail(MobileDeviceAdministrationFailure.Conflict, MobileDeviceCodes.Revoked);
            if (target.Binding.UnboundAt is not null)
                return Step.Fail(MobileDeviceAdministrationFailure.Conflict, MobileDeviceCodes.NotBound);
            var holder = await HolderAsync(target.Binding.AccountId, cancellationToken);
            MobileDeviceBindings.Close(target.Binding, now);
            target.Device.UpdatedAt = now;
            MobileDeviceBindings.Audit(context, accountId, "mobile_device.binding_closed", target.Device.PublicId,
                reason ?? "OCC liberó la tablet.", AuditSource.Api, now,
                new AuditFieldChangeData("binding.account", holder.ToString("D"), null));
            await MobileDeviceBindings.AnnounceAsync(context, [target.Device.PublicId], now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return Step.Done(target.Device.PublicId);
        }, cancellationToken);
    }

    public async Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> RevokeAsync(Guid actorId, Guid deviceId,
        RevokeMobileDeviceInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!Allowed(actor, MobileDeviceBindings.RevokePermission)) return Failed(MobileDeviceAdministrationFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(MobileDeviceAdministrationFailure.Invalid, "idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input?.ExpectedVersion))
            return Failed(MobileDeviceAdministrationFailure.Invalid, "expected_version_required");
        if (!ContractLifecycle.ValidReason(input.Reason)) return Failed(MobileDeviceAdministrationFailure.Invalid, "reason_required");
        var reason = input.Reason!.Trim();
        var stations = await ActorStationsAsync(actor!, cancellationToken);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { deviceId, expected = input.ExpectedVersion, reason });
        return await RunAsync(idempotencyKey, accountId, RevokeAction, hash, async now =>
        {
            if (await TargetAsync(deviceId, stations, cancellationToken) is not { } target)
                return Step.Fail(MobileDeviceAdministrationFailure.NotFound, "not_found");
            if (Token(target) != input.ExpectedVersion) return Step.Fail(MobileDeviceAdministrationFailure.Conflict, "version_conflict");
            if (target.Device.RevokedAt is not null)
                return Step.Fail(MobileDeviceAdministrationFailure.Conflict, MobileDeviceCodes.Revoked);
            var device = target.Device;
            // ck_mobile_device_revoked: a revocation never predates the last time the tablet was seen.
            device.RevokedAt = now < device.LastSeenAt ? device.LastSeenAt : now;
            device.UpdatedAt = now;
            var changes = new List<AuditFieldChangeData> { new("device.revoked", null, "true") };
            var bound = target.Binding.UnboundAt is null;
            // A lost tablet may still hold its last agent's session: a bound one, but also one OCC freed or whose
            // agent's ramp duty ended, because neither signs the agent out. Only the agent's own sign-out already took
            // the session off the tablet (2-N02). Every session of the account ends with its stamp.
            if (bound || !await MobileDeviceBindings.EndedBySignOutAsync(context, device.PublicId, target.Binding,
                    cancellationToken))
            {
                var holder = await context.Users.SingleAsync(user => user.Id == target.Binding.AccountId, cancellationToken);
                if (bound)
                {
                    MobileDeviceBindings.Close(target.Binding, now);
                    changes.Add(new("binding.account", holder.PublicId.ToString("D"), null));
                }
                holder.SecurityStamp = Guid.NewGuid().ToString("N");
                holder.ConcurrencyStamp = Guid.NewGuid().ToString();
                holder.UpdatedAt = now;
                changes.Add(new("account.sessions", "open", "closed"));
            }
            MobileDeviceBindings.Audit(context, accountId, "mobile_device.revoked", device.PublicId, reason, AuditSource.Api,
                now, [.. changes]);
            await MobileDeviceBindings.AnnounceAsync(context, [device.PublicId], now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return Step.Done(device.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// One command: the Idempotency-Key receipt, the work, the receipt and the commit in one serializable transaction.
    /// A replay answers the tablet as it is now and never repeats the audit, the stamp or the hints.
    /// </summary>
    private async Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> RunAsync(Guid key, long accountId,
        string action, string hash, Func<DateTimeOffset, Task<Step>> work, CancellationToken cancellationToken)
    {
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            var (step, replayed) = await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                    return (Step.Fail(MobileDeviceAdministrationFailure.Conflict, "idempotency_conflict"), false);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return (Step.Done(prior.ResultId), true);
                var now = Now();
                var done = await work(now);
                if (done.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return (done, false);
                }
                CommercialCommandReceipts.Add(context, key, accountId, action, hash, done.ResultId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return (done, false);
            });
            context.ChangeTracker.Clear();
            return step.Failure is { } failure ? Failed(failure, step.Code!) : await AnswerAsync(step.ResultId, replayed,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Failed(MobileDeviceAdministrationFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await AnswerAsync(concurrent.ResultId, true, cancellationToken)
                : Failed(MobileDeviceAdministrationFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException)
        {
            // A concurrent registration changed the binding first: OCC re-reads the tablet.
            context.ChangeTracker.Clear();
            return Failed(MobileDeviceAdministrationFailure.Conflict, "version_conflict");
        }
    }

    private async Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> AnswerAsync(Guid deviceId, bool replayed,
        CancellationToken cancellationToken)
    {
        var latest = await LatestBindings().Where(binding => context.MobileDevices.Any(device =>
            device.Id == binding.MobileDeviceId && device.PublicId == deviceId)).ToArrayAsync(cancellationToken);
        var items = await ItemsAsync(latest, cancellationToken);
        return items.Count == 1
            ? MobileDeviceAdministrationResult.Success<OccMobileDeviceData>(items[0], replayed)
            : Failed(MobileDeviceAdministrationFailure.NotFound, "not_found");
    }

    /// <summary>The tablet (locked like a registration) and its latest binding, when OCC may see it.</summary>
    private async Task<Target?> TargetAsync(Guid deviceId, long[] stations, CancellationToken cancellationToken)
    {
        var device = await context.MobileDevices
            .FromSqlInterpolated($"""
                SELECT *
                FROM [integration].[mobile_devices] WITH (UPDLOCK, HOLDLOCK)
                WHERE [public_id] = {deviceId}
                """)
            .SingleOrDefaultAsync(cancellationToken);
        if (device is null) return null;
        var binding = await context.Set<MobileDeviceAccountBinding>()
            .Where(item => item.MobileDeviceId == device.Id)
            .OrderByDescending(item => item.BoundAt).ThenByDescending(item => item.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (binding is null) return null;
        var accounts = await StationAccountsAsync(stations, cancellationToken);
        return accounts.Contains(binding.AccountId) ? new Target(device, binding) : null;
    }

    private static string Token(Target target) =>
        MobileDeviceBindingToken.Of(target.Binding.Id, target.Binding.UnboundAt is null, target.Device.RevokedAt is not null);

    private Task<Guid> HolderAsync(long accountId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.Id == accountId).Select(user => user.PublicId)
            .SingleAsync(cancellationToken);

    /// <summary>The latest binding of every tablet, open or closed.</summary>
    private IQueryable<MobileDeviceAccountBinding> LatestBindings() =>
        from binding in context.Set<MobileDeviceAccountBinding>().AsNoTracking()
        where !context.Set<MobileDeviceAccountBinding>().Any(other => other.MobileDeviceId == binding.MobileDeviceId &&
            (other.BoundAt > binding.BoundAt || (other.BoundAt == binding.BoundAt && other.Id > binding.Id)))
        select binding;

    /// <summary>Accounts that work or worked at the stations: their account scopes and their ramp-agent scopes.</summary>
    private async Task<HashSet<long>> StationAccountsAsync(long[] stations, CancellationToken cancellationToken)
    {
        if (stations.Length == 0) return [];
        var scoped = await context.AccountStationScopes.AsNoTracking().Where(scope => stations.Contains(scope.StationId))
            .Select(scope => scope.AccountId).Distinct().ToArrayAsync(cancellationToken);
        var agents = await (from scope in context.Set<RampAgentStationScope>().AsNoTracking()
                            join agent in context.RampAgents.AsNoTracking() on scope.RampAgentId equals agent.Id
                            join user in context.Users.AsNoTracking() on agent.PersonId equals user.PersonId
                            where stations.Contains(scope.StationId)
                            select user.Id).Distinct().ToArrayAsync(cancellationToken);
        return [.. scoped, .. agents];
    }

    private async Task<IReadOnlyList<OccMobileDeviceData>> ItemsAsync(MobileDeviceAccountBinding[] latest,
        CancellationToken cancellationToken)
    {
        if (latest.Length == 0) return [];
        var deviceIds = latest.Select(binding => binding.MobileDeviceId).ToArray();
        var devices = await context.MobileDevices.AsNoTracking().Where(device => deviceIds.Contains(device.Id))
            .ToDictionaryAsync(device => device.Id, cancellationToken);
        var accountIds = latest.Select(binding => binding.AccountId).Distinct().ToArray();
        var people = await (from user in context.Users.AsNoTracking()
                            join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                            where accountIds.Contains(user.Id)
                            select new { user.Id, user.PublicId, user.PersonId, person.FirstName, person.LastName })
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var personIds = people.Values.Select(item => item.PersonId).ToArray();
        var agents = await context.RampAgents.AsNoTracking().Where(agent => personIds.Contains(agent.PersonId))
            .Select(agent => new { agent.PersonId, agent.PublicId, agent.EmployeeNumber })
            .ToDictionaryAsync(agent => agent.PersonId, cancellationToken);
        var busy = (await (from user in context.Users.AsNoTracking()
                           join agent in context.RampAgents.AsNoTracking() on user.PersonId equals agent.PersonId
                           join assignment in context.OperationAgentAssignments.AsNoTracking()
                               on agent.Id equals assignment.RampAgentId
                           join operation in context.GroundOperations.AsNoTracking()
                               on assignment.GroundOperationId equals operation.Id
                           where accountIds.Contains(user.Id) && assignment.ReleasedAt == null &&
                                 operation.CurrentStatus == GroundOperationStatus.InProgress
                           select user.Id).Distinct().ToArrayAsync(cancellationToken)).ToHashSet();
        return latest.Select(binding =>
            {
                var device = devices[binding.MobileDeviceId];
                var person = people[binding.AccountId];
                var agent = agents.GetValueOrDefault(person.PersonId);
                var open = binding.UnboundAt is null && device.RevokedAt is null;
                return new OccMobileDeviceData(device.PublicId, device.Platform.ToString(), device.DeviceName,
                    device.AppVersion, device.OperatingSystemVersion, device.LastSeenAt,
                    device.RevokedAt is not null ? "Revoked" : binding.UnboundAt is null ? "Bound" : "Unbound",
                    new OccMobileDeviceAgentData(person.PublicId, agent?.PublicId, $"{person.FirstName} {person.LastName}".Trim(),
                        agent?.EmployeeNumber),
                    binding.BoundAt, binding.UnboundAt, device.RevokedAt, open && busy.Contains(binding.AccountId),
                    MobileDeviceBindingToken.Of(binding.Id, binding.UnboundAt is null, device.RevokedAt is not null));
            })
            .OrderBy(item => item.Status switch { "Bound" => 0, "Unbound" => 1, _ => 2 })
            .ThenBy(item => item.Agent?.Name, StringComparer.CurrentCulture)
            .ThenBy(item => item.DeviceName, StringComparer.CurrentCulture)
            .ToArray();
    }

    private async Task<long[]> ActorStationsAsync(ActorContext actor, CancellationToken cancellationToken)
    {
        var publicIds = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        return await context.Stations.AsNoTracking().Where(station => publicIds.Contains(station.PublicId) && station.IsActive)
            .Select(station => station.Id).ToArrayAsync(cancellationToken);
    }

    private static bool Allowed(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private DateTimeOffset Now()
    {
        var value = timeProvider.GetUtcNow();
        return new DateTimeOffset(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static MobileDeviceAdministrationResult<OccMobileDeviceData> Failed(MobileDeviceAdministrationFailure failure,
        string code) => MobileDeviceAdministrationResult.Failed<OccMobileDeviceData>(failure, code);
}
