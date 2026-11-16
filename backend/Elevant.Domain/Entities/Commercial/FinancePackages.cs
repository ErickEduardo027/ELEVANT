using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public sealed class ServicePackageVersion : AuditableEntity
{
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int VersionNumber { get; set; }
    public TariffVersionStatus Status { get; set; }
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal BasePrice { get; set; }
    public PackageConsumptionScope Scope { get; set; }
    public FlightDirection? FlightDirection { get; set; }
    /// <summary>Fixed-day periods anchored on the contract start, independently for each station.</summary>
    public int? PeriodDays { get; set; }
    public DateOnly ValidFrom { get; set; }
    public DateOnly? ValidTo { get; set; }
    public long CreatedByAccountId { get; set; }
    public long? PublishedByAccountId { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
}

public sealed class ServicePackageComponent : AuditableEntity
{
    public long PackageVersionId { get; set; }
    public long ServiceDefinitionId { get; set; }
    public string BillingUnit { get; set; } = string.Empty;
    public decimal IncludedQuantity { get; set; }
    public decimal ExcessBlockSize { get; set; }
    public decimal ExcessBlockPrice { get; set; }
}

/// <summary>Published immutable package version accepted in a frozen contract version.</summary>
public sealed class ContractServicePackage : AuditableEntity
{
    public long ContractVersionId { get; set; }
    public long PackageVersionId { get; set; }
}

/// <summary>Serializes all reservations for a package scope, including multiple components.</summary>
public sealed class PackageConsumption : AuditableEntity
{
    public long ContractPackageId { get; set; }
    public long StationId { get; set; }
    public string ScopeKey { get; set; } = string.Empty;
    public int Revision { get; set; }
}

/// <summary>Immutable measured consumption tied to its reserved source line; voiding a preinvoice releases it.</summary>
public sealed class PackageConsumptionEntry : AuditableEntity
{
    public long ConsumptionId { get; set; }
    public long ComponentId { get; set; }
    public long OperationServiceId { get; set; }
    public long ApprovedSubmissionId { get; set; }
    public long PreinvoiceLineId { get; set; }
    public decimal Quantity { get; set; }
    public decimal IncludedQuantity { get; set; }
    public decimal ExcessQuantity { get; set; }
    public decimal BaseAmount { get; set; }
    public decimal ExcessAmount { get; set; }
    public string CalculationJson { get; set; } = "{}";
}

public sealed class FinancePricingCommand : AuditableEntity
{
    public Guid RequestId { get; set; }
    public long ActorAccountId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string PayloadHash { get; set; } = string.Empty;
    public Guid ResultId { get; set; }
}
