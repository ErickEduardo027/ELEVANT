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
}
