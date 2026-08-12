import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';

export default function ReviewStatusBadge({ status }) {
  const meta = getStatusMeta('review', status);
  return <StatusBadge tone={meta.color} label={meta.label} />;
}
