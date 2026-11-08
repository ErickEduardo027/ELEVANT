using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class OperationService : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public int LineNumber { get; set; }

    public long ServiceDefinitionId { get; set; }

    public long? ContractServiceRateId { get; set; }

    public decimal ContractedQuantity { get; set; }

    public decimal ExecutedQuantity { get; set; }

    public string BillingUnitSnapshot { get; set; } = string.Empty;

    public decimal? UnitPriceSnapshot { get; set; }

    public string? CurrencyCodeSnapshot { get; set; }

    public ServiceExecutionStatus CurrentStatus { get; set; }

    /// <summary>
    /// When OCC excluded a service in exception from billing in the review (3-N11); the three exclusion fields are set
    /// together and cleared together when OCC includes it again (the audit keeps both changes).
    /// </summary>
    public DateTimeOffset? BillingExcludedAt { get; set; }

    public long? BillingExcludedByAccountId { get; set; }

    public string? BillingExclusionReason { get; set; }
}
