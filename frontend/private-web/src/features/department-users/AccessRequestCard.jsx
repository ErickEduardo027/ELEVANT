import StatusBadge from '../../components/StatusBadge';
import { DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import { permissionLabels } from './PermissionMatrix';
import { REQUEST_STATUS } from './useDepartmentGovernance';

const dateFormat = value => (value ? new Date(value).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Read-only summary of an access request shared by administrators and Human Resources. */
export default function AccessRequestCard({ request, catalog, showDepartment = false, children }) {
  const status = REQUEST_STATUS[request.status] ?? { label: request.status, tone: 'info' };
  const ramp = request.kind === 'RampAgent';
  const permissions = permissionLabels(catalog, request.permissions);
  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{request.firstName} {request.lastName}</h3>
          <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{request.email}</p>
        </div>
        <StatusBadge tone={status.tone} label={status.label} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {showDepartment && <><dt className="text-text-secondary-light">Departamento</dt><dd>{DEPARTMENT_LABELS[request.department] ?? request.department}</dd></>}
        <dt className="text-text-secondary-light">Tipo</dt><dd>{ramp ? 'Agente de rampa' : 'Usuario web'}</dd>
        <dt className="text-text-secondary-light">Solicitado por</dt><dd>{request.requestedBy} · {dateFormat(request.requestedAt)}</dd>
        <dt className="text-text-secondary-light">Estaciones</dt><dd>{request.stations.map(station => station.code).join(', ')}</dd>
        {ramp && <>
          <dt className="text-text-secondary-light">Empleado</dt><dd>{request.employeeNumber} · {request.category}</dd>
          <dt className="text-text-secondary-light">Ingreso</dt><dd>{request.hireDate}</dd>
          <dt className="text-text-secondary-light">Terminales</dt><dd>{request.terminals.map(terminal => terminal.code).join(', ') || 'Sin terminales'}</dd>
          <dt className="text-text-secondary-light">Supervisor</dt><dd>{request.supervisorName ?? 'Sin supervisor'}</dd>
        </>}
        {!ramp && <><dt className="text-text-secondary-light">Plantilla</dt><dd>{request.accessProfileName ?? 'Permisos personalizados'}</dd></>}
        {request.decidedBy && <><dt className="text-text-secondary-light">Resuelta por</dt><dd>{request.decidedBy} · {dateFormat(request.decidedAt)}</dd></>}
      </dl>
      {!ramp && permissions.length > 0 && (
        <ul className="mt-3 space-y-0.5 rounded-lg bg-black/[.03] p-3 text-xs dark:bg-white/[.04]">
          {permissions.map(label => <li key={label}>{label}</li>)}
        </ul>
      )}
      {request.status === 'Rejected' && request.decisionReason && (
        <p className="mt-3 rounded-lg bg-status-danger/10 p-3 text-xs text-status-danger">Motivo: {request.decisionReason}</p>
      )}
      {children}
    </article>
  );
}
