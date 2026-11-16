using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public sealed class ContractVersion : AuditableEntity
{
    public long ContractId { get; set; }

    public int VersionNumber { get; set; }

    public int PricingPolicyVersion { get; set; }

    public ContractVersionStatus Status { get; set; }

    public DateOnly ValidFrom { get; set; }

    public DateOnly? ValidTo { get; set; }

    public string CurrencyCode { get; set; } = string.Empty;

    public string? Terms { get; set; }

    public DateTimeOffset? ApprovedAt { get; set; }

    public long? ApprovedByAccountId { get; set; }

    /// <summary>Renewal and termination terms Contratos fixes after Finance approval (ADR-0025).</summary>
    public ContractRenewalMode? RenewalMode { get; set; }

    public int? RenewalTermMonths { get; set; }

    public int? RenewalNoticeDays { get; set; }

    public int? TerminationNoticeDays { get; set; }

    public string? TerminationTerms { get; set; }

    /// <summary>Set when Contratos confirms validity; signatures are only accepted afterwards.</summary>
    public DateTimeOffset? ValidityConfirmedAt { get; set; }

    public long? ValidityConfirmedByAccountId { get; set; }

    /// <summary>When the automatic renewal draft was created, so the sweep starts it only once.</summary>
    public DateTimeOffset? RenewalStartedAt { get; set; }
}
