import StatusBadge from '../../dashboard/components/StatusBadge';

export default function ConversationStatusBadge({ status }) {
  return <StatusBadge domain="chat" status={status} />;
}
