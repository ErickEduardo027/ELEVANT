import StatusBadge from '../../dashboard/components/StatusBadge';

export default function NotificationSeverityBadge({ severity }) {
  return <StatusBadge domain="notification" status={severity} />;
}
