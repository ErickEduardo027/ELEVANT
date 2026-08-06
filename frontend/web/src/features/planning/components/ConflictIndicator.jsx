import { AlertTriangleIcon } from '../../dashboard/components/icons';

export default function ConflictIndicator({ conflict }) {
  if (!conflict) return null;

  return (
    <span
      title={conflict.reason}
      className="inline-flex items-center gap-1 rounded-full bg-status-danger/10 px-2 py-0.5 text-xs font-medium text-status-danger"
    >
      <AlertTriangleIcon className="h-3.5 w-3.5" />
      Conflicto
    </span>
  );
}
