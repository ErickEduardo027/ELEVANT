import StatusBadge from '../../../../components/StatusBadge';
import { ACCOUNT_STATUS_META } from '../statusMeta';

// Fija el dominio "cuenta" sobre StatusBadge, igual que ReviewStatusBadge lo
// hace para "revisión" en feat/adminocc.
export default function UserStatusBadge({ status }) {
  const meta = ACCOUNT_STATUS_META[status] ?? ACCOUNT_STATUS_META.pending_activation;
  return <StatusBadge tone={meta.tone} label={meta.label} />;
}
