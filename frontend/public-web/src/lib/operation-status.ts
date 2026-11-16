/**
 * Spanish names of a ground operation's status in the portal (2-N26): the API sends the code (`InProgress`,
 * `PendingReview`…); a code the portal does not know is shown as it is.
 */
const OPERATION_STATUS: Readonly<Record<string, string>> = Object.freeze({
  planned: "Planificada",
  assigned: "Asignada",
  inprogress: "En curso",
  pendingreview: "Pendiente de revisión",
  inreview: "En revisión",
  approved: "Aprobada",
  returned: "Devuelta para corrección",
  cancelled: "Cancelada",
});

/** «En curso» for `InProgress` or `in_progress`; the code itself when it is unknown. */
export function operationStatusLabel(status: string | null | undefined): string {
  const text = (status ?? "").trim();
  return OPERATION_STATUS[text.replace(/[^a-z]/gi, "").toLowerCase()] ?? text;
}
