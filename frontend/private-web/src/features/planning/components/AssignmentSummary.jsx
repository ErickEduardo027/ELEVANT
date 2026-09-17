import { MapPinIcon, UsersIcon } from '../../dashboard/components/icons';

export default function AssignmentSummary({
  position,
  agents = [],
  equipment = [],
  services = [],
}) {
  const hasAssignment = Boolean(position) || agents.length > 0 || equipment.length > 0 || services.length > 0;

  if (!hasAssignment) {
    return <span className="text-xs text-status-warning">Recursos pendientes</span>;
  }

  return (
    <span className="flex flex-wrap items-center gap-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      {position && (
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="h-3.5 w-3.5" />
          {position}
        </span>
      )}
      <span className="inline-flex items-center gap-1" title="Agentes asignados">
        <UsersIcon className="h-3.5 w-3.5" />
        {agents.length} agente{agents.length === 1 ? '' : 's'}
      </span>
      <span>{equipment.length} equipo{equipment.length === 1 ? '' : 's'}</span>
      <span>{services.length} servicio{services.length === 1 ? '' : 's'}</span>
    </span>
  );
}
