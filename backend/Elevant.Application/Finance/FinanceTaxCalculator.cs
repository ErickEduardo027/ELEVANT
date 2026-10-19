using Elevant.Domain.Entities.Commercial;

namespace Elevant.Application.Finance;

public sealed class FinanceTaxRuleException(string code) : Exception(code)
{
    public string Code { get; } = code;
}

public static class FinanceTaxCalculator
{
    public static decimal Round(decimal value) => decimal.Round(value, 4, MidpointRounding.AwayFromZero);

    public static void Validate(FinanceTaxPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        if (policy.Treatment == FinanceTaxTreatment.Unconfigured || !Enum.IsDefined(policy.Treatment) ||
            !Enum.IsDefined(policy.ConceptKind) || policy.ConceptCode.Trim().Length is < 1 or > 40 ||
            policy.ValidFrom == default || policy.ValidTo < policy.ValidFrom || policy.CurrencyCode is not ("USD" or "DOP") ||
            policy.Treatment == FinanceTaxTreatment.Taxable &&
                (policy.Rate is not (>= 0 and <= 100) || Round(policy.Rate.Value) != policy.Rate) ||
            policy.Treatment is FinanceTaxTreatment.Exempt or FinanceTaxTreatment.NotSubject &&
                (policy.Rate is not null || policy.Basis?.Trim().Length is not (>= 3 and <= 500)) ||
            policy.Basis?.Length > 500)
            throw new FinanceTaxRuleException("invalid_tax_policy");
    }

    public static FinanceTaxPolicy? Resolve(IEnumerable<FinanceTaxPolicy> policies, long airline, long station, PreinvoiceLine line)
    {
        var all = policies.ToArray();
        var matches = all.Where(p => p.Status == FinanceTaxPolicyStatus.Published && p.AirlineId == airline &&
            p.StationId == station && p.CurrencyCode == line.CurrencyCode && p.ConceptKind == line.Kind &&
            string.Equals(p.ConceptCode, line.ServiceCode, StringComparison.OrdinalIgnoreCase) && p.ValidFrom <= line.OperationDate &&
            (p.ValidTo is null || p.ValidTo >= line.OperationDate)).ToArray();
        var shadowed = new HashSet<long>();
        foreach (var policy in matches)
        {
            var seen = new HashSet<long>();
            var prior = policy.ReplacesPolicyId;
            while (prior is { } id)
            {
                if (!seen.Add(id)) throw new FinanceTaxRuleException("ambiguous_tax_policy");
                shadowed.Add(id);
                prior = all.SingleOrDefault(p => p.Id == id)?.ReplacesPolicyId;
            }
        }
        var effective = matches.Where(p => !shadowed.Contains(p.Id)).ToArray();
        if (effective.Length > 1) throw new FinanceTaxRuleException("ambiguous_tax_policy");
        return effective.SingleOrDefault();
    }

    public static void Capture(PreinvoiceLine line, FinanceTaxPolicy? policy, DateTimeOffset now)
    {
        if (line.TaxCapturedAt is not null) return;
        if (policy is not null) Validate(policy);
        line.TaxPolicyPublicId = policy?.PublicId;
        line.TaxTreatment = policy?.Treatment ?? FinanceTaxTreatment.Unconfigured;
        line.TaxRate = policy?.Rate;
        line.TaxBasis = policy?.Basis;
        line.TaxCapturedAt = now;
        SetNet(line, line.IsExcluded ? 0 : line.Amount, 0);
    }

    private static void SetNet(PreinvoiceLine line, decimal net, decimal discount)
    {
        line.NetAmount = Round(net); line.DiscountAmount = Round(discount);
        var taxable = line.NetAmount.Value - line.DiscountAmount.Value;
        line.TaxAmount = line.TaxTreatment == FinanceTaxTreatment.Unconfigured ? null :
            line.TaxTreatment == FinanceTaxTreatment.Taxable ? Round(taxable * line.TaxRate!.Value / 100) : 0;
        line.GrossAmount = Round(taxable + (line.TaxAmount ?? 0));
        line.Amount = line.GrossAmount.Value;
    }

    /// <summary>Legacy edit input is gross. Inclusive tax is rounded once and the residual is the pretax base.</summary>
    public static void RepriceGross(PreinvoiceLine line, decimal gross)
    {
        gross = Round(gross);
        var discount = line.DiscountAmount ?? 0;
        var tax = line.TaxTreatment == FinanceTaxTreatment.Unconfigured ? (decimal?)null :
            line.TaxTreatment == FinanceTaxTreatment.Taxable ? Round(gross * line.TaxRate!.Value / (100 + line.TaxRate.Value)) : 0;
        line.NetAmount = gross - (tax ?? 0) + discount;
        line.DiscountAmount = discount; line.TaxAmount = tax;
        line.Amount = gross; line.GrossAmount = gross;
    }

    /// <summary>ComputedAmount is the original pretax valuation. Keep the captured treatment/rate and restore its gross.</summary>
    public static void RestoreComputed(PreinvoiceLine line)
    {
        SetNet(line, line.IsExcluded ? 0 : line.ComputedAmount ?? line.NetAmount ?? line.Amount, 0);
    }

    public static bool IsConfigured(PreinvoiceLine line) =>
        line.TaxCapturedAt is not null && line.TaxPolicyPublicId is not null &&
        line.TaxTreatment is FinanceTaxTreatment.Taxable or FinanceTaxTreatment.Exempt or FinanceTaxTreatment.NotSubject &&
        line.NetAmount is not null && line.DiscountAmount is not null && line.TaxAmount is not null &&
        line.GrossAmount == line.Amount && line.NetAmount - line.DiscountAmount + line.TaxAmount == line.Amount &&
        (line.TaxTreatment == FinanceTaxTreatment.Taxable ? line.TaxRate is >= 0 and <= 100 :
            line.TaxRate is null && !string.IsNullOrWhiteSpace(line.TaxBasis));
}
