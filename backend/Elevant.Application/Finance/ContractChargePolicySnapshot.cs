using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record ContractChargePolicySnapshot(string Code, string Name, string? BillingUnit, ChargeCalculationMethod Method, ChargeQuantityRule QuantityRule, int GraceMinutes, decimal RoundingIncrement);
