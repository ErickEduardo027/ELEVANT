import StatusBadge from '../../../../components/StatusBadge';
import { AGENT_OVERALL_STATUS_META } from '../statusMeta';

// Estado general del agente (columna "Estado general" de la tabla Por
// agente), derivado de sus habilitaciones — nunca almacenado.
export default function AgentStatusBadge({ status }) {
  const meta = AGENT_OVERALL_STATUS_META[status] ?? AGENT_OVERALL_STATUS_META.current;
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}
