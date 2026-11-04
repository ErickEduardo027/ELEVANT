/**
 * AVIAM's «Reporte de Vuelo» (F-OCC-AVL-6.2.12/A9, rev. 2, junio 2023) as the API knows it
 * (ADR-0031). Mirrors `FlightReportMilestones` and `IataDelayCodes` in Elevant.Application; the
 * server rejects any code not listed there.
 */
export const FLIGHT_REPORT_PHASES = [
  { id: "arrival", label: "Llegada" },
  { id: "on_stand", label: "En posición" },
  { id: "departure", label: "Salida" },
  { id: "pushback", label: "Retroempuje" },
] as const;

export type FlightReportPhase = (typeof FLIGHT_REPORT_PHASES)[number]["id"];

export interface FlightReportMilestone {
  readonly code: string;
  readonly phase: FlightReportPhase;
  readonly label: string;
}

export const FLIGHT_REPORT_MILESTONES: readonly FlightReportMilestone[] = [
  { code: "BLOCK_ON", phase: "arrival", label: "Bloqueo" },
  { code: "WALKAROUND_START", phase: "arrival", label: "Inicio inspección (walk-around)" },
  { code: "WALKAROUND_END", phase: "arrival", label: "Término inspección (walk-around)" },
  { code: "STAIRS_JETBRIDGE", phase: "arrival", label: "Escaleras / jetbridge" },
  { code: "SECOND_STAIRS", phase: "arrival", label: "2da. escalera" },
  { code: "UNLOADING_EQUIPMENT", phase: "arrival", label: "Equipo de descarga" },
  { code: "FIRST_CUSTOMS", phase: "on_stand", label: "Primeras aduanas" },
  { code: "LAST_CUSTOMS", phase: "on_stand", label: "Últimas aduanas" },
  { code: "UNLOAD_SHEET", phase: "on_stand", label: "Hoja de descarga" },
  { code: "LOAD_SHEET", phase: "on_stand", label: "Hoja de carga" },
  { code: "COMMERCIAL_CARGO", phase: "on_stand", label: "Carga comercial" },
  { code: "FIRST_MAKEUP", phase: "on_stand", label: "Primeras make-up" },
  { code: "LAST_MAKEUP", phase: "on_stand", label: "Últimas make-up" },
  { code: "FIRST_LOADING", phase: "on_stand", label: "Primera subiendo" },
  { code: "LAST_LOADING", phase: "on_stand", label: "Última subiendo" },
  { code: "LAVATORY_SERVICE", phase: "on_stand", label: "Servicio de baños" },
  { code: "POTABLE_WATER", phase: "on_stand", label: "Agua potable" },
  { code: "AMBULIFT", phase: "on_stand", label: "Ambu-lift" },
  { code: "DNCD", phase: "on_stand", label: "D. N. C. D." },
  { code: "BOARDING", phase: "departure", label: "Abordaje" },
  { code: "CARGO_DOOR_CLOSED", phase: "departure", label: "Cierre puerta carga" },
  { code: "BULK_CLOSED", phase: "departure", label: "Cierre de bulk" },
  { code: "PAX_DOOR_CLOSED", phase: "departure", label: "Cierre puerta pax" },
  { code: "STAIRS_JETBRIDGE_REMOVED", phase: "pushback", label: "Retiro escalera / JB" },
  { code: "PUSHBACK", phase: "pushback", label: "Push-back" },
];

export const IATA_DELAY_CODES: readonly { readonly code: string; readonly label: string }[] = [
  { code: "11", label: "Aceptación tardía de pasajeros" },
  { code: "12", label: "Congestión en el área de check-in" },
  { code: "13", label: "Error de check-in o pasajeros duplicados" },
  { code: "14", label: "Sobreventa" },
  { code: "15", label: "Abordaje: discrepancias o pasajeros faltantes" },
  { code: "16", label: "Servicio a pasajeros: comida, equipaje especial, VIP" },
  { code: "17", label: "Pedido de catering tardío" },
  { code: "18", label: "Procesamiento de equipaje" },
  { code: "21", label: "Documentación de carga" },
  { code: "22", label: "Posicionamiento tardío de carga" },
  { code: "23", label: "Aceptación tardía de carga" },
  { code: "31", label: "Documentación de la aeronave tardía o errónea" },
  { code: "32", label: "Carga y descarga: carga voluminosa o falta de personal" },
  { code: "33", label: "Equipo de carga: falta o avería" },
  { code: "34", label: "Equipo de servicio: falta o avería (GPU, escalera, agua)" },
  { code: "35", label: "Limpieza de la aeronave" },
  { code: "36", label: "Combustible" },
  { code: "37", label: "Catering: entrega tardía o carga" },
  { code: "38", label: "ULD, contenedores o pallets" },
  { code: "39", label: "Equipo técnico: falta o avería (pushback, tractor)" },
  { code: "41", label: "Defecto técnico de la aeronave" },
  { code: "51", label: "Daño a la aeronave durante operaciones en tierra" },
  { code: "52", label: "Daño a la aeronave por terceros (FOD)" },
  { code: "71", label: "Clima en el aeropuerto de salida" },
  { code: "81", label: "Control de tránsito aéreo (ATFM)" },
  { code: "87", label: "Instalaciones del aeropuerto (posición, puente, rampa)" },
  { code: "89", label: "Restricciones del aeropuerto de salida" },
  { code: "93", label: "Rotación: llegada tardía de la aeronave" },
  { code: "96", label: "Cambio de programación" },
];

const MILESTONE_CODES = new Set(FLIGHT_REPORT_MILESTONES.map(item => item.code));
const DELAY_CODES = new Set(IATA_DELAY_CODES.map(item => item.code));

export const isFlightReportMilestoneCode = (code: unknown): code is string =>
  typeof code === "string" && MILESTONE_CODES.has(code);

export const isIataDelayCode = (code: unknown): code is string => typeof code === "string" && DELAY_CODES.has(code);
