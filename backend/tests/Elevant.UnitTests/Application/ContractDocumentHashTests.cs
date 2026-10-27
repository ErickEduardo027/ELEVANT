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
}
