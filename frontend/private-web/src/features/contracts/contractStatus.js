/**
 * Spanish labels of the contract statuses (2-N26), shared by the agreements list, the contract detail and the
 * lifecycle panel: no screen prints the code («Draft», «Active»…). A contract that never activated waits for
 * both signatures and the airline's operating permit (ADR-0024).
 */
export const CONTRACT_STATUS = Object.freeze({
  Draft: { label: 'Pendiente de firmas y permiso', tone: 'warning' },
  Active: { label: 'Activo', tone: 'success' },
  Suspended: { label: 'Suspendido', tone: 'danger' },
  Terminated: { label: 'Terminado', tone: 'neutral' },
  Expired: { label: 'Vencido', tone: 'neutral' },
});

/** Spanish label of a status; an unknown one keeps its code so nothing is hidden. */
export const contractStatusLabel = status => CONTRACT_STATUS[status]?.label ?? String(status ?? '');

/** Tone of the status badge. */
export const contractStatusTone = status => CONTRACT_STATUS[status]?.tone ?? 'neutral';
