using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// CN-27: a signature stays valid when only descriptive master-data labels are renamed, and is asked for again when an
/// attested operational fact changes.
/// </summary>
public sealed class OperationDocumentSignedFactsTests
{
    private static readonly DateTimeOffset BlockOn = new(2026, 11, 4, 15, 5, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Pushback = new(2026, 11, 4, 16, 20, 0, TimeSpan.Zero);

    private static OperationDocumentContent Signed() => new(
        OperationDocumentRules.SchemaVersion, OperationDocumentKind.ServiceOrder, "F-RAM-AVL-MAG 04", "Rev. 02, 2023",
        "Orden de Servicio en Rampa / Ramp Order Service", "PUJ000000123",
        new DocumentFlightHeader("PUJ", "AVIAM PUJ Development", "America/Santo_Domingo", "DEV-TAT-0001",
            new DateOnly(2026, 11, 4), "Demo Airlines", "DM", "ZZ100", "MIA", BlockOn, "ZZ101", "MIA", Pushback,
            "A320 (A320)", "HI1100", "A01", 152, 149, 77_000, "Riley Ramp"),
        [new DocumentServiceLine(1, "RAMP-GPU", "Unidad generadora de energía", 1.5m, "PerHour", 120m, 180m),
            new DocumentServiceLine(2, "BAGGAGE", "Equipaje" + OperationDocumentSignedFacts.ExcludedLineSuffix, 2m,
                "PerMinute", 10m, 0m)],
        [new DocumentSurcharge("NIGHT", "Recargo nocturno", "RAMP-GPU")], "USD", 180m, "Credit",
        [new DocumentChecklistAnswer("ARR-01", "Llegada de aeronave", "Limpieza del área", "Ok", null)],
        [new DocumentMilestone("BLOCK_ON", "Bloqueo", BlockOn)],
        [new DocumentDamage(Guid.Parse("11111111-1111-7111-8111-111111111111"), 0.45m, 0.3m, "Abolladura")],
        [new DocumentDelay("34", "GPU no disponible")], ["ARR-01: sin novedad"]);

    private static OperationDocumentContent Renamed()
    {
        var signed = Signed();
        return signed with
        {
            Flight = signed.Flight with
            {
                StationName = "AVIAM Punta Cana", AirlineName = "Demo Airlines S.A.", AircraftType = "Airbus A320-200 (A320)",
            },
            Services =
            [
                signed.Services[0] with { Name = "GPU · unidad de potencia en tierra" },
                signed.Services[1] with { Name = "Manejo de equipaje" + OperationDocumentSignedFacts.ExcludedLineSuffix },
            ],
            Surcharges = [signed.Surcharges[0] with { Name = "Recargo por horario nocturno" }],
            Checklist = [signed.Checklist[0] with { Section = "Llegada", Label = "Área limpia" }],
            Milestones = [signed.Milestones[0] with { Label = "Calzos puestos" }],
        };
    }

    private static string Sha(OperationDocumentContent content) =>
        OperationDocumentRules.Sha256Of(OperationDocumentRules.CanonicalJson(content));

    [Fact]
    public void TheExcludedLabelFieldsAreExplicit() =>
        Assert.Equal(
        [
            "flight.stationName",
            "flight.airlineName",
            "flight.aircraftType (the model name; the ICAO type code in parentheses is kept)",
            "services[].name (the service name; the mark of a line OCC excluded from billing is kept)",
            "surcharges[].name",
            "checklist[].section",
            "checklist[].label",
            "milestones[].label",
        ], OperationDocumentSignedFacts.DescriptiveLabelFields);

    [Fact]
    public void RenamingMasterDataKeepsTheSignedFacts()
    {
        var signed = Signed();
        var renamed = Renamed();
        Assert.NotEqual(Sha(signed), Sha(renamed));
        Assert.True(OperationDocumentSignedFacts.AttestSameFacts(signed, renamed));
        Assert.True(OperationDocumentSignedFacts.Matches(Sha(signed), OperationDocumentRules.CanonicalJson(signed),
            Sha(renamed), OperationDocumentSignedFacts.Facts(renamed)));
    }

    [Fact]
    public void TheExactHashIsTheFastPath()
    {
        var signed = Signed();
        Assert.True(OperationDocumentSignedFacts.Matches(Sha(signed), "not json", Sha(signed), "ignored"));
        Assert.False(OperationDocumentSignedFacts.Matches(new string('a', 64), "not json", Sha(signed),
            OperationDocumentSignedFacts.Facts(signed)));
    }

    public static TheoryData<string> OperationalChanges() =>
        ["pushback", "blockOn", "milestone", "flightOut", "date", "registration", "stand", "passengers", "mtow",
            "agent", "station", "airlineCode", "aircraftTypeCode", "serviceCode", "quantity", "price", "amount",
            "excluded", "surcharge", "total", "answer", "damage", "delay", "observation"];

    [Theory]
    [MemberData(nameof(OperationalChanges))]
    public void AnOperationalChangeStillAsksForANewSignature(string change)
    {
        var signed = Signed();
        var renamed = Renamed();
        var changed = change switch
        {
            "pushback" => renamed with { Flight = renamed.Flight with { DepartureAt = Pushback.AddMinutes(5) } },
            "blockOn" => renamed with { Flight = renamed.Flight with { ArrivalAt = BlockOn.AddMinutes(-3) } },
            "milestone" => renamed with { Milestones = [renamed.Milestones[0] with { At = BlockOn.AddMinutes(1) }] },
            "flightOut" => renamed with { Flight = renamed.Flight with { FlightOut = "ZZ103" } },
            "date" => renamed with { Flight = renamed.Flight with { OperationDate = new DateOnly(2026, 11, 5) } },
            "registration" => renamed with { Flight = renamed.Flight with { Registration = "HI1101" } },
            "stand" => renamed with { Flight = renamed.Flight with { Position = "A02" } },
            "passengers" => renamed with { Flight = renamed.Flight with { PassengersOut = 150 } },
            "mtow" => renamed with { Flight = renamed.Flight with { MtowKg = 77_500 } },
            "agent" => renamed with { Flight = renamed.Flight with { AgentName = "Otra Agente" } },
            "station" => renamed with { Flight = renamed.Flight with { StationCode = "SDQ" } },
            "airlineCode" => renamed with { Flight = renamed.Flight with { AirlineIataCode = "XX" } },
            "aircraftTypeCode" => renamed with { Flight = renamed.Flight with { AircraftType = "Airbus A321 (A321)" } },
            "serviceCode" => renamed with { Services = [renamed.Services[0] with { Code = "RAMP-ACU" }, renamed.Services[1]] },
            "quantity" => renamed with { Services = [renamed.Services[0] with { Quantity = 2m }, renamed.Services[1]] },
            "price" => renamed with { Services = [renamed.Services[0] with { UnitPrice = 125m }, renamed.Services[1]] },
            "amount" => renamed with { Services = [renamed.Services[0] with { Amount = 190m }, renamed.Services[1]] },
            "excluded" => renamed with
            {
                Services = [renamed.Services[0], renamed.Services[1] with { Name = "Manejo de equipaje" }],
            },
            "surcharge" => renamed with { Surcharges = [] },
            "total" => renamed with { TotalAmount = 200m },
            "answer" => renamed with { Checklist = [renamed.Checklist[0] with { Value = "NotOk" }] },
            "damage" => renamed with { Damages = [] },
            "delay" => renamed with { Delays = [new DocumentDelay("34", "GPU averiada")] },
            "observation" => renamed with { Observations = ["ARR-01: con novedad"] },
            _ => throw new ArgumentOutOfRangeException(nameof(change)),
        };
        Assert.False(OperationDocumentSignedFacts.AttestSameFacts(signed, changed));
        Assert.False(OperationDocumentSignedFacts.Matches(Sha(signed), OperationDocumentRules.CanonicalJson(signed),
            Sha(changed), OperationDocumentSignedFacts.Facts(changed)));
    }

    [Fact]
    public void TheStoredJsonIsComparedAsParsed()
    {
        // A version stored before this rule (same canonical JSON) parses back to the same facts.
        var signed = Signed();
        var parsed = OperationDocumentRules.Parse(OperationDocumentRules.CanonicalJson(signed));
        Assert.Equal(OperationDocumentSignedFacts.Facts(signed), OperationDocumentSignedFacts.Facts(parsed));
    }
}
