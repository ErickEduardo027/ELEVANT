import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';

export default function NotificationSeverityBadge({ severity }) {
  const meta = getStatusMeta('notification', severity);
  return <StatusBadge tone={meta.color} label={meta.label} />;
}
