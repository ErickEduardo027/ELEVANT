using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Integration;

public sealed class MobileCommandReceipt : AuditableEntity
{
    public long MobileDeviceId { get; set; }

    public long AccountId { get; set; }

    public Guid? ClientBatchId { get; set; }

    public string IdempotencyKey { get; set; } = string.Empty;

    public string CommandType { get; set; } = string.Empty;

    public string PayloadHash { get; set; } = string.Empty;

    public MobileCommandStatus Status { get; set; }

    public DateTimeOffset ReceivedAt { get; set; }

    public DateTimeOffset? ProcessedAt { get; set; }

    public string? ResultJson { get; set; }

    public string? ErrorCode { get; set; }

    public string? ErrorMessage { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
}
