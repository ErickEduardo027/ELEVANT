namespace Elevant.Domain.Entities.Integration;

/// <summary>
/// The single synchronization slot of a provider (ADR-0028): only the holder of an unexpired
/// lease calls it, so restarts or replicas never sync twice. Also holds the pause after a quota
/// or authorization error, and the consecutive failures that drive the back-off.
/// </summary>
public sealed class ProviderSyncLease : AuditableEntity
{
    public string Provider { get; set; } = string.Empty;

    public Guid? HolderId { get; set; }

    public DateTimeOffset? LeasedUntil { get; set; }

    public DateTimeOffset? PausedUntil { get; set; }

    public int ConsecutiveFailures { get; set; }

    public string? LastError { get; set; }
}
