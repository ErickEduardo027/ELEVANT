import StatusBadge from '../../../../components/StatusBadge';
import { QUALIFICATION_STATUS_META } from '../statusMeta';

// Fija el dominio "habilitación" sobre StatusBadge, igual que
// UserStatusBadge lo hace para "cuenta".
export default function QualificationStatusBadge({ status }) {
  const meta = QUALIFICATION_STATUS_META[status] ?? QUALIFICATION_STATUS_META.current;
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}
