using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Integration;

public sealed class MobileDevice : AuditableEntity
{
    public Guid InstallationId { get; set; }

    public MobilePlatform Platform { get; set; }

    public string? DeviceName { get; set; }

    public string AppVersion { get; set; } = string.Empty;

    public string? OperatingSystemVersion { get; set; }

    public DateTimeOffset LastSeenAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }
}
