using Elevant.Application.Abstractions.Commercial;

namespace Elevant.UnitTests.Application;

public sealed class ContractDocumentHashTests
{
    private static ContractDocumentData Document(IReadOnlyList<string>? stations = null, IReadOnlyList<ContractDocumentRate>? rates = null,
        string? terms = "Pago a 30 días.") => new(Guid.NewGuid(), Guid.NewGuid(), "CT-001", "Active", "Demo Air", "DM", null, 2,
        "Approved", new(2026, 1, 1), null, "USD", stations ?? ["PUJ · Punta Cana", "SDQ · Las Américas"],
        rates ?? [new("RAMP", "Rampa", "operación", 150m, 1m), new("GPU", "Planta eléctrica", "hora", 40m, 1m)], terms, null, []);

    [Fact]
    public void IgnoresOrderAndReadOnlyFacts()
    {
        var first = Document();
        var reordered = Document(["SDQ · Las Américas", "PUJ · Punta Cana"],
            [new("GPU", "Planta eléctrica", "hora", 40m, 1m), new("RAMP", "Rampa", "operación", 150.0000m, 1m)]);
        Assert.Equal(first.ContentSha256, reordered.ContentSha256);
        // Signatures and the contract status are not part of what is signed.
        Assert.Equal(first.ContentSha256, (first with { ContractStatus = "Suspended", SignedOn = new(2026, 2, 1) }).ContentSha256);
    }

    [Fact]
    public void ChangesWhenAnySignedTermChanges()
    {
        var hash = Document().ContentSha256;
        Assert.NotEqual(hash, Document(rates: [new("RAMP", "Rampa", "operación", 151m, 1m), new("GPU", "Planta eléctrica", "hora", 40m, 1m)]).ContentSha256);
        Assert.NotEqual(hash, Document(terms: "Pago a 15 días.").ContentSha256);
        Assert.NotEqual(hash, Document(stations: ["PUJ · Punta Cana"]).ContentSha256);
        Assert.NotEqual(hash, (Document() with { ValidTo = new(2026, 12, 31) }).ContentSha256);
        Assert.Matches("^[0-9a-f]{64}$", hash);
    }

    private static ContractPricingTerms Pricing(bool nightExcluded = false, decimal packagePrice = 500m) => new(
        [
            new ContractDocumentCharge("NIGHT", "Recargo nocturno", "PercentOfService", null, "One", 0, 0m, nightExcluded,
                nightExcluded ? null : 25m, nightExcluded ? null : 0m),
            new ContractDocumentCharge("GPU-OT", "Exceso de GPU", "PerMinute", "minute", "OperationOverrun", 15, 1m, false, 2m, 10m),
        ],
        [
            new ContractDocumentPackage("TAT", "Escala completa", 1, "Turnaround", null, null, packagePrice, "USD",
                [new ContractDocumentPackageComponent("RAMP", "Rampa", "operation", 1m, 1m, 120m)]),
        ]);

    [Fact]
    public void SurchargesAndPackagesJoinTheSignedContentOnlyWhenPresent()
    {
        var legacy = Document();
        var priced = legacy with { Pricing = Pricing() };
        // A version signed before 2-N04 keeps exactly its hash; one with pricing signs it.
        Assert.Equal(ContractDocumentHash.Of(legacy with { Pricing = null }), legacy.ContentSha256);
        Assert.NotEqual(legacy.ContentSha256, priced.ContentSha256);
        Assert.NotEqual(priced.ContentSha256, (legacy with { Pricing = Pricing(nightExcluded: true) }).ContentSha256);
        Assert.NotEqual(priced.ContentSha256, (legacy with { Pricing = Pricing(packagePrice: 450m) }).ContentSha256);
        // The order of surcharges does not matter, nor the names shown next to the codes.
        var reordered = Pricing() with { Charges = Pricing().Charges.Reverse().ToArray() };
        Assert.Equal(priced.ContentSha256, (legacy with { Pricing = reordered }).ContentSha256);
        var renamed = Pricing() with { Charges = Pricing().Charges.Select(charge => charge with { ChargeName = "Otro" }).ToArray() };
        Assert.Equal(priced.ContentSha256, (legacy with { Pricing = renamed }).ContentSha256);
    }
}
