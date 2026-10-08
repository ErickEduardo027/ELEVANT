using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>Governed unit in which a service or charge is billed.</summary>
public sealed class BillingUnit : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>Decimal places a quantity in this unit may carry (0-4).</summary>
    public byte QuantityScale { get; set; }

    public bool IsActive { get; set; } = true;
}

/// <summary>A Finance base price list for one currency. Published versions are immutable.</summary>
public sealed class ServiceTariffVersion : AuditableEntity
{
    public string CurrencyCode { get; set; } = string.Empty;

    public DateOnly ValidFrom { get; set; }

    public DateOnly? ValidTo { get; set; }

    public TariffVersionStatus Status { get; set; }

    public string? Note { get; set; }

    public long CreatedByAccountId { get; set; }

    public DateTimeOffset? PublishedAt { get; set; }

    public long? PublishedByAccountId { get; set; }
}

/// <summary>Base price of a service in a tariff version; a null station applies to every station.</summary>
public sealed class ServiceTariffRate : AuditableEntity
{
    public long ServiceTariffVersionId { get; set; }

    public long ServiceDefinitionId { get; set; }

    public long? StationId { get; set; }

    public string BillingUnit { get; set; } = string.Empty;

    public decimal UnitPrice { get; set; }

    public decimal MinimumBillableQuantity { get; set; }
}

/// <summary>A billable charge or surcharge that ramp agents apply to an executed service.</summary>
public sealed class ChargeDefinition : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public ChargeCategory Category { get; set; }

    public ChargeCalculationMethod Method { get; set; }

    public ChargeQuantityRule QuantityRule { get; set; }

    /// <summary>Minutes not billed before a time-based charge starts counting.</summary>
    public int GraceMinutes { get; set; }

    /// <summary>Quantity increment the computed quantity is rounded up to (for example 0.25 hours).</summary>
    public decimal RoundingIncrement { get; set; }

    public bool AppliesToAllServices { get; set; } = true;

    public bool AllowMultiple { get; set; }

    public bool VisibleToAgents { get; set; } = true;

    public bool IsActive { get; set; } = true;

    public string? BillingUnit { get; set; }
}

/// <summary>Service a charge applies to when it does not apply to every service.</summary>
public sealed class ChargeDefinitionService
{
    public long ChargeDefinitionId { get; set; }

    public long ServiceDefinitionId { get; set; }
}

/// <summary>A Finance charge price list for one currency.</summary>
public sealed class ChargeTariffVersion : AuditableEntity
{
    public string CurrencyCode { get; set; } = string.Empty;

    public DateOnly ValidFrom { get; set; }

    public DateOnly? ValidTo { get; set; }

    public TariffVersionStatus Status { get; set; }

    public string? Note { get; set; }

    public long CreatedByAccountId { get; set; }

    public DateTimeOffset? PublishedAt { get; set; }

    public long? PublishedByAccountId { get; set; }
}

/// <summary>Amount (or percentage for percent charges) of a charge in a charge tariff version.</summary>
public sealed class ChargeRate : AuditableEntity
{
    public long ChargeTariffVersionId { get; set; }

    public long ChargeDefinitionId { get; set; }

    /// <summary>Amount per unit, or the percentage (0-1000) when the method is PercentOfService.</summary>
    public decimal Value { get; set; }

    public decimal MinimumAmount { get; set; }
}

/// <summary>Contract-specific treatment of a charge: excluded or negotiated.</summary>
public sealed class ContractChargeRate : AuditableEntity
{
    public long ContractVersionId { get; set; }

    public long ChargeDefinitionId { get; set; }

    public bool IsExcluded { get; set; }

    public decimal? Value { get; set; }

    public decimal? MinimumAmount { get; set; }
}

/// <summary>Daily rate recorded by Finance. Corrections add a row that supersedes the previous one.</summary>
public sealed class ExchangeRate : AuditableEntity
{
    public DateOnly RateDate { get; set; }

    public string FromCurrency { get; set; } = string.Empty;

    public string ToCurrency { get; set; } = string.Empty;

    public decimal Rate { get; set; }

    public string Source { get; set; } = string.Empty;

    public long RecordedByAccountId { get; set; }

    public long? SupersedesId { get; set; }

    public bool IsCurrent { get; set; } = true;
}

/// <summary>Finance decision on a contract version submitted for activation.</summary>
public sealed class ContractFinanceReview : AuditableEntity
{
    public long ContractVersionId { get; set; }

    public ContractFinanceDecision Decision { get; set; }

    public string? Reason { get; set; }

    public long DecidedByAccountId { get; set; }

    public DateTimeOffset DecidedAt { get; set; }

    /// <summary>Snapshot of each rate against the base tariff when Finance decided.</summary>
    public string ComparisonJson { get; set; } = "[]";
}

/// <summary>Default payment terms Finance applies to an airline's invoices.</summary>
public sealed class AirlineBillingProfile : AuditableEntity
{
    public long AirlineId { get; set; }

    public int PaymentTermDays { get; set; } = 30;

    public string? BillingEmail { get; set; }

    public string? Notes { get; set; }
}

/// <summary>Non-fiscal credit note that reduces the balance of an invoice.</summary>
public sealed class NonFiscalCreditNote : AuditableEntity
{
    public long InvoiceId { get; set; }

    public long IssuedByAccountId { get; set; }

    public Guid RequestId { get; set; }

    public string Number { get; set; } = string.Empty;

    public string CurrencyCode { get; set; } = string.Empty;

    public decimal Amount { get; set; }

    public string Reason { get; set; } = string.Empty;
}
