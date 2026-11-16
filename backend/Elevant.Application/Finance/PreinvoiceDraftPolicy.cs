namespace Elevant.Application.Finance;

public sealed record PreinvoiceDraftCandidate(
    Guid ServiceId, Guid AirlineId, Guid StationId, DateOnly OperationDate,
    string? Currency, bool Ready, decimal? Amount);

public sealed record PreinvoiceDraftLineAmount(Guid ServiceId, decimal Amount);

public sealed record PreinvoiceDraftEvaluation(
    bool Ready, string? Failure, Guid? AirlineId, string? Currency,
    decimal? Total, IReadOnlyList<PreinvoiceDraftLineAmount> Lines)
{
    public static PreinvoiceDraftEvaluation Blocked(string reason) =>
        new(false, reason, null, null, null, []);
}

/// <summary>Rejects any selection that cannot become one auditable, non-fiscal draft.</summary>
public static class PreinvoiceDraftPolicy
{
    // The integer scaled to four decimal places stays below JS MAX_SAFE_INTEGER.
    private const decimal MaximumMoney = 900_000_000_000m;

    /// <summary>The services a standalone draft takes; the issuance values up to an invoice's lines (4-N06).</summary>
    public const int DefaultMaxServices = 100;

    public static PreinvoiceDraftEvaluation Evaluate(
        Guid stationId, DateOnly from, DateOnly to,
        IReadOnlyList<PreinvoiceDraftCandidate> candidates, int maxServices = DefaultMaxServices)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        if (stationId == Guid.Empty || !FinanceApprovedServicePolicy.IsValidWindow(from, to))
            return PreinvoiceDraftEvaluation.Blocked("invalid_range");
        if (candidates.Count < 1 || candidates.Count > maxServices ||
            candidates.Any(line => line.ServiceId == Guid.Empty) ||
            candidates.Select(line => line.ServiceId).Distinct().Count() != candidates.Count)
            return PreinvoiceDraftEvaluation.Blocked(candidates.Count < 1 || candidates.Count > maxServices
                ? "invalid_selection" : "duplicate_service");

        var airlineId = candidates[0].AirlineId;
        var currency = candidates[0].Currency;
        if (airlineId == Guid.Empty)
            return PreinvoiceDraftEvaluation.Blocked("mixed_airline");
        if (candidates.Any(line => line.StationId != stationId))
            return PreinvoiceDraftEvaluation.Blocked("station_mismatch");
        if (candidates.Any(line => line.OperationDate < from || line.OperationDate > to))
            return PreinvoiceDraftEvaluation.Blocked("date_out_of_range");
        if (candidates.Any(line => line.AirlineId != airlineId))
            return PreinvoiceDraftEvaluation.Blocked("mixed_airline");
        if (currency is null || currency.Length != 3 ||
            currency.Any(character => character is < 'A' or > 'Z') ||
            candidates.Any(line => line.Currency != currency))
            return PreinvoiceDraftEvaluation.Blocked("mixed_currency");
        if (candidates.Any(line => !line.Ready))
            return PreinvoiceDraftEvaluation.Blocked("line_not_billable");

        decimal total = 0;
        var lines = new List<PreinvoiceDraftLineAmount>(candidates.Count);
        try
        {
            foreach (var line in candidates)
            {
                if (line.Amount is null or < 0 or > MaximumMoney)
                    return PreinvoiceDraftEvaluation.Blocked("invalid_amount");
                var amount = decimal.Round(line.Amount.Value, 4, MidpointRounding.AwayFromZero);
                total += amount;
                if (total > MaximumMoney)
                    return PreinvoiceDraftEvaluation.Blocked("invalid_amount");
                lines.Add(new PreinvoiceDraftLineAmount(line.ServiceId, amount));
            }
        }
        catch (OverflowException)
        {
            return PreinvoiceDraftEvaluation.Blocked("invalid_amount");
        }

        return new PreinvoiceDraftEvaluation(true, null, airlineId, currency, total, lines);
    }
}
