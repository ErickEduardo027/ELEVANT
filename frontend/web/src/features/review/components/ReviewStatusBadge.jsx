import StatusBadge from '../../dashboard/components/StatusBadge';

export default function ReviewStatusBadge({ status }) {
  return <StatusBadge domain="review" status={status} />;
}
