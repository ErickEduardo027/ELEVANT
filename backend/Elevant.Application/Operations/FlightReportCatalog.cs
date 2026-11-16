namespace Elevant.Application.Operations;

/// <summary>Phases of the operation on the tablet, in the order the agent lives them.</summary>
public static class FlightReportPhases
{
    public const string Arrival = "arrival";
    public const string OnStand = "on_stand";
    public const string Departure = "departure";
    public const string Pushback = "pushback";
}

public sealed record FlightReportMilestone(string Code, string Phase, string Label, int SortOrder);

/// <summary>
/// The timed rows of AVIAM's «Reporte de Vuelo» (F-OCC-AVL-6.2.12/A9, rev. 2, junio 2023), taken
/// literally (ADR-0031): «Operación en posición», the service times of its right column and the
/// walk-around. The agent records each one with a tap; the same record feeds every form.
/// </summary>
public static class FlightReportMilestones
{
    public static readonly IReadOnlyList<FlightReportMilestone> All =
    [
        new("BLOCK_ON", FlightReportPhases.Arrival, "Bloqueo", 1),
        new("WALKAROUND_START", FlightReportPhases.Arrival, "Inicio inspección (walk-around)", 2),
        new("WALKAROUND_END", FlightReportPhases.Arrival, "Término inspección (walk-around)", 3),
        new("STAIRS_JETBRIDGE", FlightReportPhases.Arrival, "Escaleras / jetbridge", 4),
        new("SECOND_STAIRS", FlightReportPhases.Arrival, "2da. escalera", 5),
        new("UNLOADING_EQUIPMENT", FlightReportPhases.Arrival, "Equipo de descarga", 6),
        new("FIRST_CUSTOMS", FlightReportPhases.OnStand, "Primeras aduanas", 7),
        new("LAST_CUSTOMS", FlightReportPhases.OnStand, "Últimas aduanas", 8),
        new("UNLOAD_SHEET", FlightReportPhases.OnStand, "Hoja de descarga", 9),
        new("LOAD_SHEET", FlightReportPhases.OnStand, "Hoja de carga", 10),
        new("COMMERCIAL_CARGO", FlightReportPhases.OnStand, "Carga comercial", 11),
        new("FIRST_MAKEUP", FlightReportPhases.OnStand, "Primeras make-up", 12),
        new("LAST_MAKEUP", FlightReportPhases.OnStand, "Últimas make-up", 13),
        new("FIRST_LOADING", FlightReportPhases.OnStand, "Primera subiendo", 14),
        new("LAST_LOADING", FlightReportPhases.OnStand, "Última subiendo", 15),
        new("LAVATORY_SERVICE", FlightReportPhases.OnStand, "Servicio de baños", 16),
        new("POTABLE_WATER", FlightReportPhases.OnStand, "Agua potable", 17),
        new("AMBULIFT", FlightReportPhases.OnStand, "Ambu-lift", 18),
        new("DNCD", FlightReportPhases.OnStand, "D. N. C. D.", 19),
        new("BOARDING", FlightReportPhases.Departure, "Abordaje", 20),
        new("CARGO_DOOR_CLOSED", FlightReportPhases.Departure, "Cierre puerta carga", 21),
        new("BULK_CLOSED", FlightReportPhases.Departure, "Cierre de bulk", 22),
        new("PAX_DOOR_CLOSED", FlightReportPhases.Departure, "Cierre puerta pax", 23),
        new("STAIRS_JETBRIDGE_REMOVED", FlightReportPhases.Pushback, "Retiro escalera / JB", 24),
        new("PUSHBACK", FlightReportPhases.Pushback, "Push-back", 25),
    ];

    private static readonly HashSet<string> Codes = All.Select(item => item.Code).ToHashSet(StringComparer.Ordinal);

    public static bool IsKnown(string? code) => code is not null && Codes.Contains(code);
}

public sealed record IataDelayCode(string Code, string Label);

/// <summary>
/// Standard IATA delay codes for the deviations a ramp agent reports (AHM 730). The subset that
/// ground handling observes on the ramp; the code travels with the deviation to OCC.
/// </summary>
public static class IataDelayCodes
{
    public static readonly IReadOnlyList<IataDelayCode> All =
    [
        new("11", "Aceptación tardía de pasajeros"),
        new("12", "Congestión en el área de check-in"),
        new("13", "Error de check-in o pasajeros duplicados"),
        new("14", "Sobreventa"),
        new("15", "Abordaje: discrepancias o pasajeros faltantes"),
        new("16", "Servicio a pasajeros: comida, equipaje especial, VIP"),
        new("17", "Pedido de catering tardío"),
        new("18", "Procesamiento de equipaje"),
        new("21", "Documentación de carga"),
        new("22", "Posicionamiento tardío de carga"),
        new("23", "Aceptación tardía de carga"),
        new("31", "Documentación de la aeronave tardía o errónea"),
        new("32", "Carga y descarga: carga voluminosa o falta de personal"),
        new("33", "Equipo de carga: falta o avería"),
        new("34", "Equipo de servicio: falta o avería (GPU, escalera, agua)"),
        new("35", "Limpieza de la aeronave"),
        new("36", "Combustible"),
        new("37", "Catering: entrega tardía o carga"),
        new("38", "ULD, contenedores o pallets"),
        new("39", "Equipo técnico: falta o avería (pushback, tractor)"),
        new("41", "Defecto técnico de la aeronave"),
        new("51", "Daño a la aeronave durante operaciones en tierra"),
        new("52", "Daño a la aeronave por terceros (FOD)"),
        new("71", "Clima en el aeropuerto de salida"),
        new("81", "Control de tránsito aéreo (ATFM)"),
        new("87", "Instalaciones del aeropuerto (posición, puente, rampa)"),
        new("89", "Restricciones del aeropuerto de salida"),
        new("93", "Rotación: llegada tardía de la aeronave"),
        new("96", "Cambio de programación"),
    ];

    private static readonly HashSet<string> Codes = All.Select(item => item.Code).ToHashSet(StringComparer.Ordinal);

    public static bool IsKnown(string? code) => code is not null && Codes.Contains(code);
}

/// <summary>
/// Execution checklists (ADR-0031). Every operation carries exactly one: the boarding-bridge
/// checklist when the contract includes the bridge, otherwise the Flight Report's arrival and
/// push-back checklist.
/// </summary>
public static class RampChecklists
{
    public const string Bridge = "TURNAROUND-BASE";
    public const string FlightReport = "FLIGHT-REPORT";
    public static readonly string[] Execution = [Bridge, FlightReport];
}
