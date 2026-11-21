using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// Realistic snapshots of every printable document (PR E), shared by the renderer tests and the samples harness: long
/// airline names, long service names and reasons, amounts with thousands, several pages where a document can have them.
/// </summary>
internal static class DocumentSamples
{
    public static readonly DateTimeOffset IssuedAt = new(2026, 11, 21, 1, 30, 0, TimeSpan.Zero);
    public const string LongAirline = "Aerolíneas del Caribe de Transporte Aéreo Internacional, S.A.";

    private static readonly (string Code, string Name, string Unit, decimal Quantity, decimal Price)[] Services =
    [
        ("RAMP-TAT", "Asistencia en rampa por escala completa (turnaround) con supervisión", "operation", 1m, 1450m),
        ("RAMP-GPU", "Unidad generadora de energía (GPU) 400 Hz", "hour", 2.5m, 120m),
        ("PAX-PRM", "Atención a pasajeros con movilidad reducida (ambulift y acompañamiento)", "passenger", 3m, 45.5m),
        ("RAMP-ACU", "Aire acondicionado en tierra (ACU)", "hour", 1.5m, 95m),
        ("CLEAN-CAB", "Limpieza de cabina en tránsito", "service", 1m, 380m),
        ("NIGHT", "Recargo nocturno 15 % sobre la asistencia en rampa", "operation", 1m, 217.5m),
    ];

    public static NonFiscalInvoiceData FiscalInvoice(int lines = 6, string customer = LongAirline)
    {
        var items = Enumerable.Range(0, lines).Select(index =>
        {
            var service = Services[index % Services.Length];
            var net = decimal.Round(service.Quantity * service.Price, 2);
            var tax = decimal.Round(net * 0.18m, 2);
            return new NonFiscalInvoiceLineData(Guid.NewGuid(), index + 1, $"PUJ-OP-2026-{1180 + index / 3:0000}",
                new DateOnly(2026, 10, 1).AddDays(index / 3), service.Code, service.Name, service.Quantity, service.Unit, service.Price,
                net + tax, net, tax);
        }).ToArray();
        var netTotal = items.Sum(line => line.NetAmount!.Value);
        var taxTotal = items.Sum(line => line.TaxAmount!.Value);
        return new NonFiscalInvoiceData(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
            "DEV-NF-2026-00000000000000000000042", "USD", netTotal + taxTotal, IssuedAt, items,
            new NonFiscalInvoiceFiscalData("E310000000042", "Q7K2M9", IssuedAt, new DateOnly(2026, 12, 20), netTotal, taxTotal,
                "AVIAM Ltd.", FinanceInvoicePolicy.SimulatedIssuerRnc, customer, "PUJ", "131234569", "DO"));
    }

    public static NonFiscalInvoiceData LegacyInvoice() => FiscalInvoice() with { Fiscal = null, Number = "DEV-NF-2026-0007" };

    public static FinanceAdjustmentNoteDocumentData CreditNote() => new(Guid.NewGuid(), "E340000000011", "Credit", Guid.NewGuid(),
        "DEV-NF-2026-00000000000000000000042", "E310000000042", "USD", 413m, new DateOnly(2026, 11, 21), IssuedAt,
        "La aerolínea reportó que el servicio de aire acondicionado en tierra se prestó durante 45 minutos y no durante la " +
        "hora y media facturada; el supervisor de turno lo confirmó con la bitácora de la posición 14 y el registro del equipo.",
        "AVIAM Ltd.", FinanceInvoicePolicy.SimulatedIssuerRnc, LongAirline, "ACT", "PUJ",
        [
            new FinanceAdjustmentNoteDocumentLineData(4, "PUJ-OP-2026-1181", "RAMP-ACU", "Aire acondicionado en tierra (ACU)", 0.75m,
                84.07m, 71.25m, 12.82m, 18m),
            new FinanceAdjustmentNoteDocumentLineData(5, "PUJ-OP-2026-1181", "CLEAN-CAB", "Limpieza de cabina en tránsito", 0.75m,
                328.93m, 278.75m, 50.18m, 18m),
        ], "131234569", "DO");

    public static FinanceAdjustmentNoteDocumentData DebitNote() => CreditNote() with
    {
        Number = "E330000000003", Kind = "Debit", Amount = 141.6m, Reason = "Servicio de GPU adicional no facturado.",
        Lines = [new FinanceAdjustmentNoteDocumentLineData(2, "PUJ-OP-2026-1180", "RAMP-GPU", "Unidad generadora de energía (GPU) 400 Hz",
            1m, 141.6m, 120m, 21.6m, 18m)],
    };

    public static NonFiscalPaymentData Payment() => new(Guid.NewGuid(), Guid.NewGuid(), "TRF-BHD-2026-118842", "USD", 2500m,
        IssuedAt, LongAirline, "Transfer", new DateOnly(2026, 11, 20), "E310000000042", 4115.57m, 1615.57m, new DateOnly(2026, 11, 21));

    public static CardPaymentReceiptData CardReceipt() => new(Guid.NewGuid(), LongAirline, "DEV-NF-2026-00000000000000000000042",
        "E310000000042", "Visa", "1111", "AUTH-731904", 1615.57m, "USD", IssuedAt, "CARD-2026-000318", 4115.57m, 0m,
        new DateOnly(2026, 11, 21));

    public static FinanceTreasuryReceiptDocumentData TreasuryReceipt() => new("COB-PUJ-2026-000094", LongAirline,
        "RNC 1-31-23456-9", "PUJ", "USD", 6000m, "Transfer", new DateOnly(2026, 11, 20), IssuedAt, "Ana Pérez Martínez",
        "Transferencia del Banco BHD por las facturas de la primera quincena de noviembre.", 5731.14m, 0m, 268.86m, false,
        [
            new FinanceTreasuryReceiptApplicationDocumentData("E310000000042", new DateOnly(2026, 11, 20), 4115.57m, "USD", 4115.57m, 0m),
            new FinanceTreasuryReceiptApplicationDocumentData("E310000000043", new DateOnly(2026, 11, 20), 1615.57m, "USD", 1615.57m, 1200m),
        ]);

    public static FinanceStatementDocumentData Statement(int movements = 48)
    {
        var rows = new List<FinanceStatementMovementDocumentData>();
        for (var index = 0; index < movements; index++)
        {
            var day = new DateOnly(2026, 10, 1).AddDays(index);
            rows.Add(index % 3 == 2
                ? new(day, $"COB-PUJ-2026-{index:000000}", "Cobro por transferencia aplicado a facturas", 0m, 1850.25m)
                : new(day, $"E3100000001{index:00}", "Factura de servicios de asistencia en tierra", 1234.56m + index * 10, 0m));
        }
        return new FinanceStatementDocumentData(LongAirline, "RNC 1-31-23456-9", "ACT", "PUJ · Punta Cana",
            new DateOnly(2026, 11, 20), new DateOnly(2026, 10, 1), "USD", IssuedAt, "Ana Pérez Martínez", 3200m,
            new FinanceStatementAgingDocumentData(8450.2m, 3120.4m, 980m, 0m, 0m, 268.86m, 0m, 12281.74m),
            Enumerable.Range(0, 9).Select(index => new FinanceStatementInvoiceDocumentData($"E3100000002{index:00}",
                new DateOnly(2026, 10, 5).AddDays(index * 5), new DateOnly(2026, 11, 4).AddDays(index * 5), Math.Max(0, 16 - index * 5),
                2400m + index * 115.5m, 1300m + index * 50m)).ToArray(),
            rows);
    }

    public static ContractDocumentData Contract(string status = "Approved", int rates = 34, string code = "CTR-2026-000123")
    {
        var document = new ContractDocumentData(Guid.NewGuid(), Guid.NewGuid(), code, "Active", "Caribe Air",
            "CQ", LongAirline, 2, status, new DateOnly(2026, 11, 1), new DateOnly(2027, 10, 31), "USD",
            ["PUJ · Punta Cana", "SDQ · Las Américas", "STI · Cibao"],
            Enumerable.Range(0, rates).Select(index => new ContractDocumentRate($"SRV-{index + 1:00}",
                index % 4 == 0 ? "Asistencia en rampa por escala completa con supervisión, GPU y escaleras incluidas" : $"Servicio {index + 1}",
                index % 2 == 0 ? "operation" : "hour", 85m + index * 12.5m, 1m)).ToArray(),
            string.Join('\n', Enumerable.Range(1, 12).Select(index =>
                $"La Aerolínea notifica a AVIAM cualquier cambio de itinerario con al menos 24 horas de anticipación (condición {index}).")),
            status == "Approved" ? new DateOnly(2026, 11, 2) : null, [])
        {
            AirlineTaxRegistration = new Elevant.Domain.Validation.TaxRegistration("131234569", "DO"),
            Validity = new ContractValidityTerms("Automatic", 1, 1, 30, null, IssuedAt),
        };
        return status == "Approved"
            ? document with
            {
                Signatures =
                [
                    new ContractDocumentSignature("Aviam", "Ana Pérez Martínez", "Gerente comercial", IssuedAt, document.ContentSha256),
                    new ContractDocumentSignature("Airline", "Luis Rodríguez", "Director de operaciones", IssuedAt.AddHours(3),
                        document.ContentSha256),
                ],
            }
            : document;
    }

    private static readonly DocumentFlightHeader Flight = new("PUJ", "Aeropuerto Internacional de Punta Cana",
        "America/Santo_Domingo", "PUJ-OP-2026-1180", new DateOnly(2026, 11, 14), LongAirline, "CQ", "CQ1234", "MIA",
        new DateTimeOffset(2026, 11, 14, 15, 5, 0, TimeSpan.Zero), "CQ1235", "JFK",
        new DateTimeOffset(2026, 11, 14, 16, 40, 0, TimeSpan.Zero), "B738", "HI1045", "14", 152, 148, 79016,
        "Pedro Guzmán");

    public static OperationDocumentContent Operation(OperationDocumentKind kind) => new(
        OperationDocumentRules.SchemaVersion, kind,
        kind switch
        {
            OperationDocumentKind.ServiceOrder => "F-RAM-AVL-MAG 04",
            OperationDocumentKind.FlightReport => "F-MGO-AVL 8.14.1/A1",
            OperationDocumentKind.CharterServiceRequest => "F-COM-AVL 02",
            _ => "F-MGO-AVL 8.14.1/A2",
        }, "Rev. 02, 2023", kind.ToString(), "PUJ000000123", Flight,
        Services.Select((service, index) => new DocumentServiceLine(index + 1, service.Code, service.Name, service.Quantity,
            service.Unit, service.Price, decimal.Round(service.Quantity * service.Price, 2))).ToArray(),
        [new DocumentSurcharge("NIGHT", "Recargo nocturno", "RAMP-TAT")], "USD", 3410.25m, "Credit",
        [
            new DocumentChecklistAnswer("ARR-01", "Llegada de aeronave", "Área de parqueo limpia y libre de FOD antes de la llegada", "Ok", null),
            new DocumentChecklistAnswer("ARR-02", "Llegada de aeronave", "Señalero en posición con equipo de comunicación", "Ok", null),
            new DocumentChecklistAnswer("PUSH-11", "Retroempuje de aeronave", "Puntualidad del retroempuje según el itinerario", "NotOk",
                "Llegó tarde"),
            new DocumentChecklistAnswer("BRG-01", "Antes de la operación", "Puente con la llave recibida y el área libre de obstáculos",
                "Ok", null),
            new DocumentChecklistAnswer("BRG-02", "Después de la operación", "Puente retirado y estacionado en la posición de reposo",
                "NotApplicable", null),
        ],
        [
            new DocumentMilestone("BLOCK_ON", "Bloqueo", new DateTimeOffset(2026, 11, 14, 15, 5, 0, TimeSpan.Zero)),
            new DocumentMilestone("PUSHBACK", "Retroempuje", new DateTimeOffset(2026, 11, 14, 16, 42, 0, TimeSpan.Zero)),
        ],
        [new DocumentDamage(Guid.Parse("11111111-1111-7111-8111-111111111111"), 0.45m, 0.3m, "Abolladura en la puerta de carga")],
        [new DocumentDelay("34", "GPU no disponible")], ["ARR-01: sin novedad", "Pasajero PRM asistido con ambulift"],
        kind == OperationDocumentKind.CharterServiceRequest
            ? new DocumentCharter("MDPC/PUJ", "1200 NW 78th Avenue, Suite 300, Doral, Florida 33126, Estados Unidos", LongAirline)
            : null);

    public static IReadOnlyList<OperationDocumentSignatureData> Signatures(OperationDocumentKind kind) =>
        OperationDocumentRules.RolesFor(kind).Select((role, index) => new OperationDocumentSignatureData(role,
            index == 0 ? "Luis Rodríguez" : "Pedro Guzmán", new DateTimeOffset(2026, 11, 14, 16, 50 + index, 0, TimeSpan.Zero),
            new string('a', 64), [[0.1m, 0.5m, 0.3m, 0.2m, 0.5m, 0.6m, 0.8m, 0.3m]], index == 0 ? "001-1234567-8" : null)).ToArray();
}
