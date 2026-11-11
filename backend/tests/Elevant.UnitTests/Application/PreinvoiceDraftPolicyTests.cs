using Elevant.Application.Finance;

namespace Elevant.UnitTests.Application;

public sealed class PreinvoiceDraftPolicyTests
{
    private static readonly Guid AirlineId = Guid.NewGuid();
    private static readonly Guid StationId = Guid.NewGuid();
    private static readonly DateOnly Date = new(2026, 9, 26);

    [Fact]
    public void SelectsOneAirlineStationAndCurrencyAndRoundsEachLine()
    {
        var result = PreinvoiceDraftPolicy.Evaluate(StationId, Date, Date,
            [Candidate(Guid.NewGuid(), 1.00005m), Candidate(Guid.NewGuid(), 2.00005m)]);

        Assert.True(result.Ready);
        Assert.Equal("USD", result.Currency);
        Assert.Equal(AirlineId, result.AirlineId);
        Assert.Equal(3.0002m, result.Total);
        Assert.Equal([1.0001m, 2.0001m], result.Lines.Select(line => line.Amount));
    }

    [Fact]
    public void RejectsDuplicateOrBlockedOrCrossScopeOrMixedCurrency()
    {
        var first = Candidate(Guid.NewGuid(), 10m);
        Assert.Equal("duplicate_service", Evaluate([first, first]).Failure);
        Assert.Equal("line_not_billable", Evaluate([first with { Ready = false }]).Failure);
        Assert.Equal("mixed_airline", Evaluate([first, Candidate(Guid.NewGuid(), 3m) with
            { AirlineId = Guid.NewGuid() }]).Failure);
        Assert.Equal("mixed_currency", Evaluate([first, Candidate(Guid.NewGuid(), 3m) with
            { Currency = "DOP" }]).Failure);
        Assert.Equal("station_mismatch", Evaluate([first with { StationId = Guid.NewGuid() }]).Failure);
        Assert.Equal("date_out_of_range", Evaluate([first with { OperationDate = Date.AddDays(-1) }]).Failure);
    }

    [Fact]
    public void RejectsEmptyAndOversizedSelectionsAndAmountOverflow()
    {
        Assert.Equal("invalid_selection", Evaluate([]).Failure);
        Assert.Equal("invalid_selection", Evaluate(Enumerable.Range(0, 101)
            .Select(_ => Candidate(Guid.NewGuid(), 1m)).ToArray()).Failure);
        Assert.Equal("invalid_amount", Evaluate([Candidate(Guid.NewGuid(), 1_000_000_000_000_000m)]).Failure);
        Assert.Equal("invalid_range", PreinvoiceDraftPolicy.Evaluate(
            StationId, default, default, [Candidate(Guid.NewGuid(), 1m)]).Failure);
    }

    /// <summary>4-N06: the issuance values up to an invoice's 500 lines; a standalone draft keeps 100.</summary>
    [Fact]
    public void TheIssuanceValuesUpToTheInvoiceLineLimit()
    {
        var services = Enumerable.Range(0, 320).Select(_ => Candidate(Guid.NewGuid(), 1m)).ToArray();
        Assert.Equal("invalid_selection", Evaluate(services).Failure);
        Assert.True(PreinvoiceDraftPolicy.Evaluate(StationId, Date, Date, services, FinanceInvoicePolicy.MaxLines).Ready);
        Assert.Equal("invalid_selection", PreinvoiceDraftPolicy.Evaluate(StationId, Date, Date,
            Enumerable.Range(0, 501).Select(_ => Candidate(Guid.NewGuid(), 1m)).ToArray(), FinanceInvoicePolicy.MaxLines).Failure);
    }

    private static PreinvoiceDraftEvaluation Evaluate(IReadOnlyList<PreinvoiceDraftCandidate> lines) =>
        PreinvoiceDraftPolicy.Evaluate(StationId, Date, Date, lines);

    private static PreinvoiceDraftCandidate Candidate(Guid id, decimal amount) =>
        new(id, AirlineId, StationId, Date, "USD", true, amount);
}
