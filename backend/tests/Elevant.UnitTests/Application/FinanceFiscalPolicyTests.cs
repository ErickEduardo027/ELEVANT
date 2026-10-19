using System.Text;
using System.Text.Json;
using System.Xml.Linq;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;

namespace Elevant.UnitTests.Application;

public sealed class FinanceFiscalPolicyTests
{
    [Fact]
    public void OffDefaultsToNoWorkAndSandboxCannotBeEnabledByConfiguration()
    {
        Assert.Equal(FiscalMode.Off, new FinanceFiscalOptions().Mode);
        Assert.Equal(FinanceFiscalFailure.Disabled, FinanceFiscalPolicy.ExecutionFailure(new()));
        Assert.Equal(FinanceFiscalFailure.ProviderNotConfigured, FinanceFiscalPolicy.ExecutionFailure(
            new() { Mode = FiscalMode.ProviderSandbox }));
        Assert.Null(FinanceFiscalPolicy.ExecutionFailure(new() { Mode = FiscalMode.LocalSimulation }));
    }

    [Fact]
    public void MissingFrozenTaxCannotProduceACanonicalSnapshotEvenForZeroGross()
    {
        Assert.Throws<ArgumentException>(() => FinanceFiscalPolicy.Snapshot(InvoiceId, "NF-SYNTHETIC", "USD", 0m,
            [new FiscalSnapshotLine(1, "Service", null, null, "OP", new(2026, 10, 18), "GPU", "Synthetic GPU", 1, "unit", 0, "USD", 0)],
            CommercialSnapshot, 0, 0, 0));
    }

    [Fact]
    public void SnapshotIsOrderedFrozenAndFinanciallyValidated()
    {
        var lines = new[] { Line(2, 30m), Line(1, 70m) };
        var snapshot = FinanceFiscalPolicy.Snapshot(InvoiceId, "NF-SYNTHETIC", "USD", 100m, lines, CommercialSnapshot, 100, 0, 0);
        lines[0] = Line(2, 99m);
        Assert.Equal(snapshot, FinanceFiscalPolicy.Snapshot(InvoiceId, "NF-SYNTHETIC", "USD", 100m,
            [Line(1, 70m), Line(2, 30m)], CommercialSnapshot, 100, 0, 0));
        using var json = JsonDocument.Parse(snapshot);
        Assert.Equal(1, json.RootElement.GetProperty("lines")[0].GetProperty("lineNumber").GetInt32());
        Assert.Equal(30m, json.RootElement.GetProperty("lines")[1].GetProperty("amount").GetDecimal());
        Assert.Throws<ArgumentException>(() => FinanceFiscalPolicy.Snapshot(InvoiceId, "NF", "USD", 101m,
            [Line(1, 100m)], CommercialSnapshot, 100, 0, 0));
        Assert.Throws<ArgumentException>(() => FinanceFiscalPolicy.Snapshot(InvoiceId, "NF", "USD", 200m,
            [Line(1, 100m), Line(1, 100m)], CommercialSnapshot, 200, 0, 0));
    }

    [Fact]
    public void CanonicalRetainsOriginalCommercialBytesAndExactFrozenDiscountTaxAmounts()
    {
        var line = Line(1, 114) with { UnitPrice = 100, Net = 100, Discount = 5, Tax = 19, Rate = 20, Basis = "Frozen synthetic reviewed treatment" };
        var canonical = FinanceFiscalPolicy.Snapshot(InvoiceId, "NF-SYNTHETIC", "USD", 114, [line], CommercialSnapshot, 100, 5, 19);
        using var json = JsonDocument.Parse(canonical); var root = json.RootElement; var frozen = root.GetProperty("lines")[0];
        Assert.Equal(CommercialSnapshot, root.GetProperty("originalCommercialSnapshot").GetString());
        Assert.Equal(100, root.GetProperty("net").GetDecimal()); Assert.Equal(5, root.GetProperty("discount").GetDecimal());
        Assert.Equal(19, root.GetProperty("tax").GetDecimal()); Assert.Equal(114, root.GetProperty("gross").GetDecimal());
        Assert.Equal(100, frozen.GetProperty("net").GetDecimal()); Assert.Equal(5, frozen.GetProperty("discount").GetDecimal());
        Assert.Equal(19, frozen.GetProperty("tax").GetDecimal()); Assert.Equal(114, frozen.GetProperty("gross").GetDecimal());
        Assert.Equal("Taxable", frozen.GetProperty("treatment").GetString()); Assert.Equal(20, frozen.GetProperty("rate").GetDecimal());
        Assert.Equal(line.Basis, frozen.GetProperty("basis").GetString()); Assert.Equal(line.PolicyId, frozen.GetProperty("policyId").GetGuid());
        Assert.Equal(FinanceFiscalPolicy.Disclaimer, root.GetProperty("disclaimer").GetString());
        Assert.Contains("statutory fiscal validation not performed", root.GetProperty("taxValidation").GetString());
        Assert.Throws<ArgumentException>(() => FinanceFiscalPolicy.Snapshot(InvoiceId, "NF", "USD", 114, [line], CommercialSnapshot, 100, 6, 19));
    }

    [Theory]
    [InlineData("Unconfigured", null, null)]
    [InlineData("Taxable", null, null)]
    [InlineData("Taxable", 0.12345, null)]
    [InlineData("Exempt", null, null)]
    [InlineData("NotSubject", null, " ")]
    [InlineData("Exempt", 0d, "Synthetic basis")]
    public void InvalidOrUnconfiguredFrozenTreatmentCannotProduceFiscalCanonical(string treatment, double? rate, string? basis)
    {
        var line = Line(1, 100) with { Treatment = treatment, Rate = rate is { } value ? (decimal)value : null, Basis = basis };
        Assert.Throws<ArgumentException>(() => FinanceFiscalPolicy.Snapshot(InvoiceId, "NF", "USD", 100, [line], CommercialSnapshot, 100, 0, 0));
    }

    [Theory]
    [InlineData("Taxable", 0, null)]
    [InlineData("Exempt", null, "Synthetic reviewed exemption")]
    [InlineData("NotSubject", null, "Synthetic reviewed non-subjection")]
    public void ExplicitZeroOrReviewedNonTaxableTreatmentRemainsSimulationOnly(string treatment, int? rate, string? basis)
    {
        var line = Line(1, 100) with { Treatment = treatment, Rate = rate, Basis = basis };
        var canonical = FinanceFiscalPolicy.Snapshot(InvoiceId, "NF", "USD", 100, [line], CommercialSnapshot, 100, 0, 0);
        using var json = JsonDocument.Parse(canonical);
        Assert.Equal(0, json.RootElement.GetProperty("tax").GetDecimal());
        Assert.Equal(FinanceFiscalPolicy.Disclaimer, json.RootElement.GetProperty("disclaimer").GetString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("{}")]
    [InlineData("{malformed}")]
    [InlineData("{\"issuer\":null,\"customer\":{}}")]
    public void MissingOrInvalidOriginalCommercialSnapshotCannotBeFilledFromCurrentProfiles(string? commercial)
    {
        Assert.Throws<ArgumentException>(() => FinanceFiscalPolicy.Snapshot(InvoiceId, "NF", "USD", 100, [Line(1, 100)], commercial, 100, 0, 0));
    }

    [Theory]
    [InlineData(FiscalSimulationOutcome.Accepted, FiscalState.Accepted)]
    [InlineData(FiscalSimulationOutcome.Rejected, FiscalState.Rejected)]
    [InlineData(FiscalSimulationOutcome.Conditional, FiscalState.Conditional)]
    [InlineData(FiscalSimulationOutcome.Pending, FiscalState.Pending)]
    [InlineData(FiscalSimulationOutcome.Timeout, FiscalState.Unknown)]
    [InlineData(FiscalSimulationOutcome.Unknown, FiscalState.Unknown)]
    public async Task SimulationIsDeterministicAndNeverAllocatesOfficialIdentifiers(FiscalSimulationOutcome outcome, FiscalState expected)
    {
        var adapter = new FinanceFiscalLocalSimulator();
        var request = new FiscalProviderRequest(InvoiceId, "Development", outcome, Encoding.UTF8.GetBytes("synthetic"));
        var first = await adapter.SubmitAsync(request, TestContext.Current.CancellationToken);
        var second = await adapter.SubmitAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(expected, first.State);
        Assert.Equal(first.OriginalBytes, second.OriginalBytes);
        Assert.Equal(first.ProviderDocumentId, second.ProviderDocumentId);
        Assert.StartsWith("SIM-", first.ProviderDocumentId);
        Assert.Null(first.DgiiResponseId);
        Assert.Null(first.Encf);
        Assert.Contains("SIMULATION WITHOUT FISCAL VALIDITY", Encoding.UTF8.GetString(first.OriginalBytes));
    }

    [Fact]
    public void ArtifactManifestSeparatesWellFormednessFromOfficialValidationAndPreservesSnapshotBytes()
    {
        var snapshot = FinanceFiscalPolicy.Snapshot(InvoiceId, "NF-SYNTHETIC", "USD", 100m, [Line(1, 100m)], CommercialSnapshot, 100, 0, 0);
        var artifacts = FinanceFiscalArtifacts.Build(InvoiceId, "Development", snapshot);
        Assert.Equal(3, artifacts.Count);
        Assert.Equal(Encoding.UTF8.GetBytes(snapshot), Assert.Single(artifacts, a => a.Kind == FiscalArtifactKind.CanonicalJson).Bytes);
        var xml = XDocument.Parse(Encoding.UTF8.GetString(Assert.Single(artifacts, a => a.Kind == FiscalArtifactKind.SimulationXml).Bytes));
        Assert.Equal("FiscalSimulation", xml.Root!.Name.LocalName);
        Assert.Contains("SIMULATION WITHOUT FISCAL VALIDITY", xml.ToString());
        using var manifest = JsonDocument.Parse(Assert.Single(artifacts, a => a.Kind == FiscalArtifactKind.Manifest).Bytes);
        Assert.Equal("NotPerformed", manifest.RootElement.GetProperty("officialXsdValidation").GetString());
        Assert.False(manifest.RootElement.GetProperty("signed").GetBoolean());
        Assert.False(manifest.RootElement.GetProperty("officialQr").GetBoolean());
    }

    [Fact]
    public void UnknownNeverBecomesDispatchableAndTerminalCallbacksCannotOverwriteFinalState()
    {
        Assert.False(FinanceFiscalPolicy.CanDispatch(FiscalState.Unknown));
        Assert.False(FinanceFiscalPolicy.CanDispatch(FiscalState.Accepted));
        Assert.True(FinanceFiscalPolicy.CanApply(FiscalState.Pending, FiscalState.Accepted, 1, 2));
        Assert.False(FinanceFiscalPolicy.CanApply(FiscalState.Pending, FiscalState.Accepted, 2, 1));
        Assert.False(FinanceFiscalPolicy.CanApply(FiscalState.Accepted, FiscalState.Rejected, 2, 3));
        Assert.True(FinanceFiscalPolicy.CanApply(FiscalState.Unknown, FiscalState.Accepted, 1, 2));
    }

    [Fact]
    public async Task DefaultCallbackAuthenticationRejectsForgedState()
    {
        var verifier = new FinanceFiscalRejectCallbacks();
        Assert.Null(await verifier.AuthenticateAsync("Development", "forged", Encoding.UTF8.GetBytes("{\"state\":\"Accepted\"}"),
            TestContext.Current.CancellationToken));
    }

    private static readonly Guid InvoiceId = Guid.Parse("deadbeef-0000-4000-8000-000000000001");
    private const string CommercialSnapshot = " { \"issuer\": {\"legalName\":\"Synthetic frozen issuer\"}, \"customer\": {\"legalName\":\"Synthetic frozen customer\"} } ";
    private static FiscalSnapshotLine Line(int number, decimal amount) => new(number, "Service", null, null,
        "OP-SYNTHETIC", new DateOnly(2026, 10, 18), "BAG", "Synthetic service", 1m, "operation", amount, "USD", amount,
        amount, 0, 0, amount, "Taxable", 0, "Synthetic explicit zero", Guid.Parse("deadbeef-0000-4000-8000-000000000002"),
        new DateTimeOffset(2026, 10, 18, 12, 0, 0, TimeSpan.Zero));
}
