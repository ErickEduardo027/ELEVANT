import StatusBadge from '../../../../components/StatusBadge';
import { PERMIT_STATUS_META } from '../statusMeta';

// Fija el dominio "documento" sobre StatusBadge, igual que
// QualificationStatusBadge lo hace para "habilitación".
export default function PermitStatusBadge({ status }) {
  const meta = PERMIT_STATUS_META[status] ?? PERMIT_STATUS_META.current;
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}
