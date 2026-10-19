using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public enum FinanceTaxTreatment { Unconfigured, Taxable, Exempt, NotSubject }
public enum FinanceTaxPolicyStatus { Draft, Published }

/// <summary>Published policies are immutable. A replacement overrides its ancestor only during its explicit validity.</summary>
public sealed class FinanceTaxPolicy : AuditableEntity
{
    public long AirlineId { get; set; }
    public long StationId { get; set; }
    public string CurrencyCode { get; set; } = string.Empty;
    public PreinvoiceLineKind ConceptKind { get; set; }
    public string ConceptCode { get; set; } = string.Empty;
    public FinanceTaxTreatment Treatment { get; set; }
    /// <summary>Percentage, including an explicitly configured zero; null for exempt/not subject.</summary>
    public decimal? Rate { get; set; }
    public string? Basis { get; set; }
    public DateOnly ValidFrom { get; set; }
    public DateOnly? ValidTo { get; set; }
    public long? ReplacesPolicyId { get; set; }
    public FinanceTaxPolicyStatus Status { get; set; }
    public long CreatedByAccountId { get; set; }
    public long? PublishedByAccountId { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
}

public sealed class FinanceTaxCommand : AuditableEntity
{
    public Guid RequestId { get; set; }
    public long ActorAccountId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string PayloadHash { get; set; } = string.Empty;
    public Guid ResultId { get; set; }
}
