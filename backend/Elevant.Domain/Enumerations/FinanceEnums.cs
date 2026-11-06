namespace Elevant.Domain.Enumerations;

/// <summary>
/// Lifecycle of a Finance tariff book (services or charges) and of a service package version.
/// <see cref="Discarded"/> and <see cref="Retired"/> apply to packages only (1-N27): a discarded
/// draft never published, and a retired publication is no longer offered nor approved, while the
/// approved contracts that froze it keep it.
/// </summary>
public enum TariffVersionStatus
{
    Draft,
    Published,
    Superseded,
    Discarded,
    Retired,
}

public enum ChargeCategory
{
    Surcharge,
    AdditionalCharge,
    Minimum,
    Manual,
}

/// <summary>How the charge amount is derived from its rate.</summary>
public enum ChargeCalculationMethod
{
    FixedAmount,
    PercentOfService,
    PerHour,
    PerMinute,
    PerUnit,
}

/// <summary>Which recorded measurement gives the quantity of a time- or unit-based charge.</summary>
public enum ChargeQuantityRule
{
    One,
    ServiceDuration,
    OperationOverrun,
    ArrivalDelay,
    ServiceQuantity,
}

public enum ContractFinanceDecision
{
    Approved,
    Returned,
}

public enum PreinvoiceLineKind
{
    Service,
    Charge,
    Adjustment,
    Package,
    Excess,
    Minimum,
}

public enum PaymentMethod
{
    Transfer,
    Check,
    Cash,
    Other,

    /// <summary>Simulated card payment from the airline portal (ADR-0036); never recorded by hand.</summary>
    Card,
}

/// <summary>Outcome of a simulated card authorization (ADR-0036).</summary>
public enum CardPaymentStatus
{
    Approved,
    Declined,
    Error,
}
