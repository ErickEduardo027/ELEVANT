import StatusBadge from '../../../../components/StatusBadge';
import { AGENT_PERMIT_STATUS_META } from '../statusMeta';

// Estado general del agente (columna "Estado general" de la tabla),
// derivado de sus dos documentos — nunca almacenado.
export default function AgentPermitStatusBadge({ status }) {
  const meta = AGENT_PERMIT_STATUS_META[status] ?? AGENT_PERMIT_STATUS_META.current;
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}
