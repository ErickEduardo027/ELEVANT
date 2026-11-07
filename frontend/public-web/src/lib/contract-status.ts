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

/** What the home says about a standing that is not in force (2-N32); null when nothing needs saying. */
export function standingNotice(standing: AirlinePortalStandingResponse | null | undefined): string | null {
  if (!standing) return null;
  const pending = standing.contracts.find(contract => contract.status === "Draft" && contract.pendingReason);
  switch (standing.status) {
    case "Suspended":
      return "Su contrato con AVIAM está suspendido: no se planifican ni se atienden vuelos nuevos. Sus operaciones, " +
        "facturas y pagos siguen disponibles; revise el motivo en Contratos.";
    case "Expired":
      return "Su contrato con AVIAM venció: no se atienden vuelos nuevos. Su historial, sus facturas y sus pagos siguen disponibles.";
    case "Terminated":
      return "Su contrato con AVIAM terminó. Su historial, sus facturas y sus pagos siguen disponibles.";
    case "Pending":
      return pending?.pendingReason === "operating_permit"
        ? "Su contrato está firmado: se activa cuando AVIAM verifique su permiso de operación vigente."
        : "Su contrato aún no está activo: falta la firma de ambas partes. Revíselo en Contratos.";
    case "None":
      return "Todavía no tiene un contrato aprobado con AVIAM.";
    default:
      return null;
  }
}
