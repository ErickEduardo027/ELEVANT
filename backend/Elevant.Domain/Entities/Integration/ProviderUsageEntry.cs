using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Integration;

/// <summary>
/// One call to a paid data provider (ADR-0028): the units it cost, why it was made and how it
/// ended. Append-only; the daily and monthly budgets are sums over these rows.
/// </summary>
public sealed class ProviderUsageEntry : AuditableEntity
{
    public string Provider { get; set; } = string.Empty;

    public string Operation { get; set; } = string.Empty;

    public long? StationId { get; set; }

    public DateTimeOffset? WindowFrom { get; set; }

    public DateTimeOffset? WindowTo { get; set; }

    public int Units { get; set; }

    public int? HttpStatus { get; set; }

    public ProviderCallOutcome Outcome { get; set; }

    public ProviderCallTrigger Trigger { get; set; }

    public long? RequestedByAccountId { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public int FlightsReceived { get; set; }
}
