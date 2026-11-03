namespace Elevant.Application.Operations;

public sealed record PresenceHeartbeat(Guid ClientId, long Sequence, string Mode, bool ActivityObserved);
public sealed record PresenceIdentity(Guid AccountId, string Name, string Role);
public sealed record OperationPresenceContacts(Guid OperationId, IReadOnlyList<PresenceIdentity> Participants);
public sealed record OperationPresenceContactsList(IReadOnlyList<OperationPresenceContacts> Operations);
public sealed record ParticipantPresence(Guid AccountId, string Name, string Role, string State, DateTimeOffset? LastActivityAt,
    string? Availability, string? Message);
public sealed record OperationPresenceData(Guid OperationId, IReadOnlyList<ParticipantPresence> Participants);
public sealed record OperationPresenceList(DateTimeOffset AsOf, IReadOnlyList<OperationPresenceData> Operations);
public sealed record AccountPresence(string State, DateTimeOffset? LastActivityAt, string? Availability = null, string? Message = null);
/// <summary>A null availability means "automatic": the connection state alone is shown.</summary>
public sealed record PresenceStatusUpdate(string? Availability, string? Message);
public sealed record OwnPresence(string State, string? Availability, string? Message);

/// <summary>
/// Ephemeral, single-process leases plus the availability each account chose for itself.
/// No operational data or availability is inferred: a chosen status is only published while
/// the account holds a live lease, and nothing here survives a process restart.
/// </summary>
public sealed class OperationalPresenceRegistry(TimeProvider clock)
{
    private sealed record Lease(long Sequence, string Mode, DateTimeOffset SeenAt, DateTimeOffset? ActivityAt);
    private readonly object gate = new();
    private sealed record Choice(string? Availability, string? Message, DateTimeOffset SetAt);
    private readonly Dictionary<(Guid Account, Guid Client), Lease> leases = [];
    private readonly Dictionary<Guid, Choice> choices = [];
    public static readonly IReadOnlyList<string> Availabilities =
        ["available", "busy", "doNotDisturb", "beRightBack", "away", "appearOffline"];
    public const int MessageMaxLength = 80;
    public static readonly TimeSpan HeartbeatLifetime = TimeSpan.FromSeconds(90);
    public static readonly TimeSpan ActivityLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan Retention = TimeSpan.FromHours(24);

    public bool Write(Guid accountId, PresenceHeartbeat heartbeat)
    {
        if (accountId == Guid.Empty || heartbeat.ClientId == Guid.Empty || heartbeat.Sequence < 0 ||
            heartbeat.Mode is not ("foreground" or "background" or "closed")) return false;
        lock (gate)
        {
            var now = clock.GetUtcNow();
            foreach (var key in leases.Where(pair => now - pair.Value.SeenAt >= Retention).Select(pair => pair.Key).ToArray())
                leases.Remove(key);
            var keyNow = (accountId, heartbeat.ClientId);
            leases.TryGetValue(keyNow, out var previous);
            if (previous is not null && (previous.Mode == "closed" || heartbeat.Sequence <= previous.Sequence)) return true;
            leases[keyNow] = new Lease(heartbeat.Sequence, heartbeat.Mode, now,
                heartbeat.Mode != "closed" && heartbeat.ActivityObserved ? now : previous?.ActivityAt);
            return true;
        }
    }

    public bool SetStatus(Guid accountId, PresenceStatusUpdate update)
    {
        var message = string.IsNullOrWhiteSpace(update.Message) ? null : update.Message.Trim();
        if (accountId == Guid.Empty || (update.Availability is { } value && !Availabilities.Contains(value)) ||
            message is { Length: > MessageMaxLength } || (message?.Any(char.IsControl) ?? false)) return false;
        lock (gate)
        {
            if (update.Availability is null && message is null) choices.Remove(accountId);
            else choices[accountId] = new Choice(update.Availability, message, clock.GetUtcNow());
            return true;
        }
    }

    /// <summary>What other participants see: "appear offline" hides the real connection.</summary>
    public AccountPresence Read(Guid accountId)
    {
        lock (gate)
        {
            var connection = Connection(accountId, clock.GetUtcNow());
            var choice = CurrentChoice(accountId);
            if (choice?.Availability == "appearOffline")
                return new(connection.State == "unknown" ? "unknown" : "offline", null, null, choice.Message);
            var connected = connection.State is "active" or "away";
            return connection with { Availability = connected ? choice?.Availability : null, Message = choice?.Message };
        }
    }

    public OwnPresence ReadOwn(Guid accountId)
    {
        lock (gate)
        {
            var choice = CurrentChoice(accountId);
            return new(Connection(accountId, clock.GetUtcNow()).State, choice?.Availability, choice?.Message);
        }
    }

    private Choice? CurrentChoice(Guid accountId)
    {
        if (!choices.TryGetValue(accountId, out var choice)) return null;
        if (clock.GetUtcNow() - choice.SetAt < Retention) return choice;
        choices.Remove(accountId);
        return null;
    }

    private AccountPresence Connection(Guid accountId, DateTimeOffset now)
    {
        var known = leases.Where(pair => pair.Key.Account == accountId && now - pair.Value.SeenAt < Retention)
            .Select(pair => pair.Value).ToArray();
        if (known.Length == 0) return new("unknown", null);
        var last = known.Select(item => item.ActivityAt).Max();
        var connected = known.Where(item => item.Mode != "closed" && now - item.SeenAt < HeartbeatLifetime).ToArray();
        var active = connected.Any(item => item.Mode == "foreground" && item.ActivityAt is { } at && now - at < ActivityLifetime);
        return new(active ? "active" : connected.Length > 0 ? "away" : "offline", last);
    }
}
