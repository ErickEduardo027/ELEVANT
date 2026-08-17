import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';

export default function ConversationStatusBadge({ status }) {
  const meta = getStatusMeta('chat', status);
  return <StatusBadge tone={meta.color} label={meta.label} />;
}
