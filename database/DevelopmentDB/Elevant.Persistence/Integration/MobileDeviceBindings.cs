using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>
/// Who holds a shared tablet (2-N02). A binding is never deleted: it closes (<c>unbound_at</c>) when the agent signs
/// out, another agent takes the tablet, the agent signs in on it again (each session holds its own binding), OCC frees
/// or revokes it, or the agent's ramp duty ends (termination, transfer, office position, deactivated profile). Each
/// closure is audited and announced to OCC (<see cref="Resource"/>).
/// </summary>
internal static class MobileDeviceBindings
{
    /// <summary>Account-change resource OCC's tablet screen re-reads.</summary>
    public const string Resource = "mobile_devices";

    public const string ReadPermission = "operations.devices.read";
    public const string UnbindPermission = "operations.devices.unbind";
    public const string RevokePermission = "operations.devices.revoke";
    public const string EntityType = "integration.mobile_devices";

    /// <summary>Audit action of the agent's own sign-out (<c>POST mobile/device/release</c>).</summary>
    public const string ReleasedAction = "mobile_device.binding_released";

    /// <summary>
    /// Audit action of a new sign-in of the agent on the tablet it still held from an earlier session: that binding
    /// closes and the new session opens its own (<see cref="Elevant.Application.Integration.MobileDeviceSession"/>).
    /// </summary>
    public const string RenewedAction = "mobile_device.binding_renewed";

    /// <summary>Closes the binding now; a binding never ends before it began (ck_device_binding_dates).</summary>
    public static void Close(MobileDeviceAccountBinding binding, DateTimeOffset now) =>
        binding.UnboundAt = now < binding.BoundAt ? binding.BoundAt : now;

    /// <summary>
    /// The closed binding ended with its agent's own sign-out, audited at the instant it closed: the app removed the
    /// session from the tablet then. OCC freeing it or the end of the agent's ramp duty left that session on it.
    /// Anything that cannot be proven a sign-out counts as not one.
    /// </summary>
    public static Task<bool> EndedBySignOutAsync(ElevantDbContext context, Guid devicePublicId,
        MobileDeviceAccountBinding binding, CancellationToken cancellationToken) =>
        binding.UnboundAt is not { } unboundAt
            ? Task.FromResult(false)
            : context.AuditEntries.AsNoTracking().AnyAsync(entry => entry.EntityType == EntityType &&
                entry.EntityPublicId == devicePublicId && entry.Action == ReleasedAction &&
                entry.ActorAccountId == binding.AccountId && entry.OccurredAt == unboundAt, cancellationToken);

    /// <summary>
    /// Closes every tablet the account holds, inside the caller's transaction (the release path of a ramp agent,
    /// 2-N06). Returns the tablets it freed; the caller saves.
    /// </summary>
    public static async Task<IReadOnlyList<Guid>> CloseForAccountAsync(ElevantDbContext context, long accountId,
        long actorAccountId, string reason, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var open = await context.Set<MobileDeviceAccountBinding>()
            .Where(binding => binding.AccountId == accountId && binding.UnboundAt == null)
            .ToArrayAsync(cancellationToken);
        if (open.Length == 0) return [];
        var deviceIds = open.Select(binding => binding.MobileDeviceId).ToArray();
        var devices = await context.MobileDevices.AsNoTracking().Where(device => deviceIds.Contains(device.Id))
            .ToDictionaryAsync(device => device.Id, device => device.PublicId, cancellationToken);
        var account = await context.Users.AsNoTracking().Where(user => user.Id == accountId)
            .Select(user => user.PublicId).SingleAsync(cancellationToken);
        foreach (var binding in open)
        {
            Close(binding, now);
            Audit(context, actorAccountId, "mobile_device.binding_closed", devices[binding.MobileDeviceId], reason,
                AuditSource.Api, now, new AuditFieldChangeData("binding.account", account.ToString("D"), null));
        }
        await AnnounceAsync(context, devices.Values, now, cancellationToken);
        return devices.Values.ToArray();
    }

    /// <summary>OCC accounts that see the tablets re-read them (the data travels by REST, never in the hint).</summary>
    public static async Task AnnounceAsync(ElevantDbContext context, IEnumerable<Guid> deviceIds, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var devices = deviceIds.Distinct().ToArray();
        if (devices.Length == 0) return;
        var recipients = await DepartmentAccessQueries.AccountsWithPermissionAsync(context, ReadPermission,
            cancellationToken);
        foreach (var recipient in recipients)
            foreach (var device in devices)
                AccountChangeOutboxWriter.Add(context, recipient, null, Resource, device, now);
    }

    public static void Audit(ElevantDbContext context, long actorAccountId, string action, Guid devicePublicId,
        string? reason, AuditSource source, DateTimeOffset now, params AuditFieldChangeData[] changes) =>
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
            ActorAccountId = actorAccountId, Action = action, EntityType = EntityType, EntityPublicId = devicePublicId,
            Source = source, CorrelationId = Guid.CreateVersion7(), Reason = reason,
            MetadataJson = SafeAuditChanges.Serialize(changes),
        });

    /// <summary>
    /// The account's ramp agent works an operation right now (started, not submitted): its tablet keeps it until
    /// the agent signs out or OCC frees it (2-N02).
    /// </summary>
    public static Task<bool> HasOperationInProgressAsync(ElevantDbContext context, long accountId,
        CancellationToken cancellationToken) =>
        (from user in context.Users.AsNoTracking()
         join agent in context.RampAgents.AsNoTracking() on user.PersonId equals agent.PersonId
         join assignment in context.OperationAgentAssignments.AsNoTracking() on agent.Id equals assignment.RampAgentId
         join operation in context.GroundOperations.AsNoTracking() on assignment.GroundOperationId equals operation.Id
         where user.Id == accountId && assignment.ReleasedAt == null &&
               operation.CurrentStatus == GroundOperationStatus.InProgress
         select operation.Id).AnyAsync(cancellationToken);
}
