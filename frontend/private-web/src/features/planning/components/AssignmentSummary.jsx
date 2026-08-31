import { MapPinIcon, UsersIcon } from '../../dashboard/components/icons';

export default function AssignmentSummary({ position, supervisor, agents = [], teams = [] }) {
  const hasAssignment = Boolean(position) || Boolean(supervisor) || agents.length > 0 || teams.length > 0;

  if (!hasAssignment) {
    return (
      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Sin asignar</span>
    );
  }

  return (
    <span className="flex items-center gap-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {position && (
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="h-3.5 w-3.5" />
          {position}
        </span>
      )}
      {supervisor && <span>{supervisor}</span>}
      {agents.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <UsersIcon className="h-3.5 w-3.5" />
          {agents.length}
        </span>
      )}
      {teams.length > 0 && (
        <span>
          {teams.length} equipo{teams.length > 1 ? 's' : ''}
        </span>
      )}
    </span>
  );
}
