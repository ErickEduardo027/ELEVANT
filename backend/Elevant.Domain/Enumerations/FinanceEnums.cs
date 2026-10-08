namespace Elevant.Domain.Enumerations;

/// <summary>Lifecycle of a Finance tariff book (services or charges).</summary>
public enum TariffVersionStatus
{
    Draft,
    Published,
    Superseded,
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
}

public enum PaymentMethod
{
    Transfer,
    Check,
    Cash,
    Other,
}
