import type { AirlinePortalStandingResponse } from "@elevant/api-client";
import { addDays } from "./business-day";

/**
 * How the portal names a contract (2-N35): a contract that never activated is never a «Borrador» once Finance
 * approved it; it waits for both signatures or for the operating permit, as the standing tells (2-N32).
 */
const STATUS: Readonly<Record<string, string>> = Object.freeze({
  Active: "Activo", Suspended: "Suspendido", Terminated: "Terminado", Expired: "Vencido",
});

const PENDING: Readonly<Record<string, string>> = Object.freeze({
  signatures: "Pendiente de firmas",
  operating_permit: "Pendiente de permiso de operación",
});

type StandingContract = AirlinePortalStandingResponse["contracts"][number];

/** The contract of the standing with that id, when the standing is loaded. */
export function standingContract(standing: AirlinePortalStandingResponse | null | undefined, contractId: string):
  StandingContract | undefined {
  return standing?.contracts.find(contract => contract.id === contractId);
}

/** The label of a contract: its status, or what a contract that never activated waits for. */
export function contractStatusLabel(status: string, pendingReason?: string | null): string {
  if (status === "Draft") return pendingReason && PENDING[pendingReason] ? PENDING[pendingReason]! : "Pendiente de activación";
  return STATUS[status] ?? status;
}

/**
 * What the contract card adds after its signing date (2-N14). `terminatedOn` is the first day without coverage: a
 * terminated contract ended that day; in any other status the termination is only scheduled. An active contract still
 * covers operations until the day before; a suspended or expired one covers none now, so only the day it ends is
 * stated. Empty without a termination.
 */
export function terminationNote(status: string, terminatedOn: string | null | undefined): string {
  if (!terminatedOn) return "";
  if (status === "Terminated") return ` · Terminado: ${terminatedOn}`;
  return status === "Active"
    ? ` · Terminación programada: cubre operaciones hasta el ${addDays(terminatedOn, -1)}`
    : ` · Terminación programada: termina el ${terminatedOn}`;
}

/** An approved version both parties have not signed yet: a renewal or an amendment shows «Pendiente de firmas». */
export function versionAwaitingSignatures(contract: StandingContract | undefined, versionId: string): boolean {
  return Boolean(contract?.versionsAwaitingSignatures.includes(versionId));
}

/** The contract that tells what a pending standing waits for: the notice and the badge name the same one. */
function pendingContract(standing: AirlinePortalStandingResponse): StandingContract | undefined {
  return standing.contracts.find(contract => contract.status === "Draft" && contract.pendingReason);
}

/** The tone of the standing badge (N14): in force, waiting for something, suspended, or nothing in force. */
export type StandingTone = "ok" | "pending" | "warning" | "none";

/**
 * What the portal's badge says about the airline's standing (N14): «Contrato en vigor» only while a contract covers a
 * station today, otherwise what the airline waits for or why nothing is in force. Null until the standing is read, so
 * the portal claims nothing while it loads or when it cannot be read.
 */
export function standingBadge(standing: AirlinePortalStandingResponse | null | undefined):
  { label: string; tone: StandingTone } | null {
  if (!standing) return null;
  switch (standing.status) {
    case "Active":
      // An active contract whose version starts later covers no station today.
      return standing.readOnly ? { label: "Contrato activo · sin estación en vigor", tone: "pending" }
        : { label: "Contrato en vigor", tone: "ok" };
    case "Pending":
      return { label: contractStatusLabel("Draft", pendingContract(standing)?.pendingReason), tone: "pending" };
    case "Suspended":
      return { label: "Contrato suspendido", tone: "warning" };
    case "Expired":
      return { label: "Contrato vencido", tone: "none" };
    case "Terminated":
      return { label: "Contrato terminado", tone: "none" };
    case "None":
      return { label: "Sin contrato con AVIAM", tone: "none" };
    default:
      return null;
  }
}

/** A station the portal names: the bootstrap and the standing describe it with at least these fields. */
type NamedStation = { id: string; code: string; name: string };

/**
 * The stations in force today (N14): the standing's current ones once it is read, the bootstrap's until then or when
 * it cannot be read. The API answers both at different moments, so a screen that shows the standing takes its
 * stations from it too and never pairs «Contrato en vigor» with «Sin estación en vigor».
 */
export function stationsInForce(standing: AirlinePortalStandingResponse | null | undefined,
  bootstrapStations: readonly NamedStation[]): readonly NamedStation[] {
  return standing ? standing.stations.filter(station => station.current) : bootstrapStations;
}

/** What the home says about a standing that is not in force (2-N32); null when nothing needs saying. */
export function standingNotice(standing: AirlinePortalStandingResponse | null | undefined): string | null {
  if (!standing) return null;
  const pending = pendingContract(standing);
  switch (standing.status) {
    case "Suspended":
      return "Su contrato con AVIAM está suspendido: no se planifican ni se atienden vuelos nuevos. Sus operaciones, " +
        "facturas y pagos siguen disponibles; revise el motivo en Contratos.";
    case "Expired":
      return "Su contrato con AVIAM venció: no se atienden vuelos nuevos. Su historial, sus facturas y sus pagos siguen disponibles.";
    case "Terminated":
      return "Su contrato con AVIAM terminó. Su historial, sus facturas y sus pagos siguen disponibles.";
    case "Pending":
      if (pending?.pendingReason === "operating_permit") {
        return "Su contrato está firmado: se activa cuando AVIAM verifique su permiso de operación vigente.";
      }
      // Without a reason the contract is signed and its permit usable (the badge says «Pendiente de activación»).
      return pending?.pendingReason === "signatures"
        ? "Su contrato aún no está activo: falta la firma de ambas partes. Revíselo en Contratos."
        : "Su contrato aún no está activo. Revise su estado en Contratos.";
    case "None":
      return "Todavía no tiene un contrato aprobado con AVIAM.";
    default:
      return null;
  }
}
