using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Operations;

namespace Elevant.UnitTests.Application;

public sealed class OperationDocumentRulesTests
{
    private static readonly DocumentFlightHeader Flight = new("PUJ", "Punta Cana", "America/Santo_Domingo", "DEV-TAT-0001",
        new DateOnly(2026, 11, 4), "Demo Airlines", "DM", "ZZ100", "MIA", new DateTimeOffset(2026, 11, 4, 15, 5, 0, TimeSpan.Zero),
        "ZZ101", "MIA", new DateTimeOffset(2026, 11, 4, 16, 20, 0, TimeSpan.Zero), "A320 (A320)", "HI1100", "A01", 152, 149,
        77_000, "Riley Ramp");

    private static OperationDocumentContent Content(OperationDocumentKind kind, int? passengersIn = 152) => new(
        OperationDocumentRules.SchemaVersion, kind, "F-RAM-AVL-MAG 04", "Rev. 02, 2023", "Orden de Servicio", "PUJ000000123",
        Flight with { PassengersIn = passengersIn },
        [new DocumentServiceLine(1, "RAMP-GPU", "Unidad generadora de energía", 1.5m, "PerHour", 120m, 180m)],
        [new DocumentSurcharge("NIGHT", "Recargo nocturno", "RAMP-GPU")], "USD", 180m, "Credit",
        [new DocumentChecklistAnswer("ARR-01", "Llegada de aeronave", "Limpieza del área", "Ok", null),
            new DocumentChecklistAnswer("PUSH-11", "Retroempuje de aeronave", "Puntualidad", "NotOk", "Llegó tarde")],
        [new DocumentMilestone("BLOCK_ON", "Bloqueo", new DateTimeOffset(2026, 11, 4, 15, 5, 0, TimeSpan.Zero))],
        [new DocumentDamage(Guid.Parse("11111111-1111-7111-8111-111111111111"), 0.45m, 0.3m, "Abolladura")],
        [new DocumentDelay("34", "GPU no disponible")], ["ARR-01: sin novedad"]);

    [Fact]
    public void EachFormAsksForItsOwnSigners()
    {
        Assert.Equal([OperationSignatureRole.AirlineRepresentative, OperationSignatureRole.AviamAgent],
            OperationDocumentRules.RolesFor(OperationDocumentKind.ServiceOrder));
        Assert.Equal([OperationSignatureRole.Coordinator], OperationDocumentRules.RolesFor(OperationDocumentKind.FlightReport));
        Assert.Equal([OperationSignatureRole.BridgeOperator],
            OperationDocumentRules.RolesFor(OperationDocumentKind.BridgeChecklist));
    }

    [Fact]
    public void TheNumberIsTheStationAndANineDigitSequence() =>
        Assert.Equal("PUJ000000123", OperationDocumentRules.NumberFor("puj", 123));

    [Fact]
    public void TheHashIsStableAndChangesWithABillableDatum()
    {
        var first = OperationDocumentRules.Sha256Of(OperationDocumentRules.CanonicalJson(Content(OperationDocumentKind.ServiceOrder)));
        var again = OperationDocumentRules.Sha256Of(OperationDocumentRules.CanonicalJson(Content(OperationDocumentKind.ServiceOrder)));
        var changed = OperationDocumentRules.Sha256Of(OperationDocumentRules.CanonicalJson(
            Content(OperationDocumentKind.ServiceOrder, 153)));
        Assert.Equal(first, again);
        Assert.NotEqual(first, changed);
        Assert.True(OperationDocumentRules.IsSha256(first));
        var parsed = OperationDocumentRules.Parse(OperationDocumentRules.CanonicalJson(Content(OperationDocumentKind.ServiceOrder)));
        Assert.Equal(first, OperationDocumentRules.Sha256Of(OperationDocumentRules.CanonicalJson(parsed)));
    }

    [Fact]
    public void StrokesAreNormalizedAndImplausibleOnesRefused()
    {
        var normalized = OperationDocumentRules.NormalizeStrokes([[0.12345m, 0.5m, 0.9999m, 0.25m]]);
        Assert.Equal([0.123m, 0.5m, 1.000m, 0.25m], Assert.Single(normalized!));
        Assert.Null(OperationDocumentRules.NormalizeStrokes([]));
        Assert.Null(OperationDocumentRules.NormalizeStrokes([[0.1m, 0.2m, 0.3m]]));
        Assert.Null(OperationDocumentRules.NormalizeStrokes([[0.1m, 1.2m, 0.3m, 0.4m]]));
        Assert.Null(OperationDocumentRules.NormalizeStrokes(Enumerable.Range(0, 65)
            .Select(_ => (IReadOnlyList<decimal>)[0.1m, 0.1m, 0.2m, 0.2m]).ToArray()));
    }

    [Theory]
    [InlineData("  Ana   Pérez ", "Ana Pérez")]
    [InlineData("A", null)]
    public void SignerNamesAreTrimmed(string input, string? expected) =>
        Assert.Equal(expected, OperationDocumentRules.NormalizeSignerName(input));

    [Fact]
    public void OnlyJpegAndPngPhotosAreAccepted()
    {
        Assert.Equal("image/jpeg", OperationDocumentRules.SniffPhoto([0xFF, 0xD8, 0xFF, 0xE0]));
        Assert.Equal("image/png", OperationDocumentRules.SniffPhoto([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0]));
        Assert.Null(OperationDocumentRules.SniffPhoto("%PDF-1.7"u8.ToArray()));
    }

    [Theory]
    [InlineData(GroundOperationStatus.InProgress, true)]
    [InlineData(GroundOperationStatus.PendingReview, true)]
    [InlineData(GroundOperationStatus.Returned, true)]
    [InlineData(GroundOperationStatus.Approved, false)]
    [InlineData(GroundOperationStatus.Cancelled, false)]
    public void FormsAreSignedFromStartUntilApproval(GroundOperationStatus status, bool allowed) =>
        Assert.Equal(allowed, OperationDocumentRules.CanSign(status, DateTimeOffset.UtcNow));

    [Theory]
    [InlineData(OperationDocumentKind.ServiceOrder)]
    [InlineData(OperationDocumentKind.FlightReport)]
    [InlineData(OperationDocumentKind.BridgeChecklist)]
    [InlineData(OperationDocumentKind.CharterServiceRequest)]
    public void EveryFormRendersAsPdfWithItsSignature(OperationDocumentKind kind)
    {
        var content = Content(kind);
        var signature = new OperationDocumentSignatureData(OperationDocumentRules.RolesFor(kind)[0], "Ana Pérez",
            DateTimeOffset.UtcNow, new string('a', 64), [[0.1m, 0.5m, 0.4m, 0.2m, 0.7m, 0.6m]]);
        var pdf = new OperationDocumentPdfRenderer().Render(content, new string('a', 64), [signature],
            new Dictionary<Guid, DamagePhoto>());
        Assert.Equal("%PDF"u8.ToArray(), pdf[..4]);
        Assert.True(pdf.Length > 2_000);
    }

    /// <summary>
    /// 3-N02: a Service Order OCC corrected after the signature prints «Corregida por OCC…» with its reasons and keeps
    /// the signatures of the version they were drawn on; the other forms ignore corrections.
    /// </summary>
    [Fact]
    public void ACorrectedServiceOrderPrintsTheCorrectionsWithTheSignatures()
    {
        var content = Content(OperationDocumentKind.ServiceOrder);
        IReadOnlyList<OperationDocumentSignatureData> signatures =
        [
            new(OperationSignatureRole.AirlineRepresentative, "Ana Pérez", new DateTimeOffset(2026, 11, 4, 16, 0, 0,
                TimeSpan.Zero), new string('b', 64), [[0.1m, 0.5m, 0.4m, 0.2m]]),
            new(OperationSignatureRole.AviamAgent, "Riley Ramp", new DateTimeOffset(2026, 11, 4, 16, 1, 0, TimeSpan.Zero),
                new string('b', 64), [[0.2m, 0.6m, 0.5m, 0.3m]]),
        ];
        var renderer = new OperationDocumentPdfRenderer(new FixedTime(new DateTimeOffset(2026, 11, 5, 12, 0, 0,
            TimeSpan.Zero)));
        var signed = renderer.Render(content, new string('a', 64), signatures, new Dictionary<Guid, DamagePhoto>());
        var corrected = renderer.Render(content, new string('a', 64), signatures, new Dictionary<Guid, DamagePhoto>(),
            [new OperationDocumentCorrectionData("Se quitó el recargo nocturno: la operación fue diurna.",
                new DateTimeOffset(2026, 11, 5, 10, 0, 0, TimeSpan.Zero), "Alex Operations")]);
        Assert.Equal("%PDF"u8.ToArray(), corrected[..4]);
        Assert.True(corrected.Length > signed.Length);
        var report = Content(OperationDocumentKind.FlightReport);
        Assert.Equal(renderer.Render(report, new string('a', 64), [], new Dictionary<Guid, DamagePhoto>()).Length,
            renderer.Render(report, new string('a', 64), [], new Dictionary<Guid, DamagePhoto>(),
                [new OperationDocumentCorrectionData("No aplica a este formulario", DateTimeOffset.UtcNow, "OCC")]).Length);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
