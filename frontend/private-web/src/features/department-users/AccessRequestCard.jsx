import StatusBadge from '../../components/StatusBadge';
import { DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import { useTranslation } from '../../i18n/LanguageScope';
import { departmentUsersMessages, enumLabel } from './departmentUsersMessages';
import { permissionLabels } from './PermissionMatrix';
import { REQUEST_STATUS_TONES } from './useDepartmentGovernance';

const dateFormat = (value, locale) => (value ? new Date(value).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Read-only summary of an access request shared by administrators and Human Resources. */
export default function AccessRequestCard({ request, catalog, showDepartment = false, children }) {
  const { t, locale } = useTranslation(departmentUsersMessages);
  const tone = REQUEST_STATUS_TONES[request.status] ?? 'info';
  const ramp = request.kind === 'RampAgent';
  const permissions = permissionLabels(catalog, request.permissions);
  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{request.firstName} {request.lastName}</h3>
          <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{request.email}</p>
        </div>
        <StatusBadge tone={tone} label={enumLabel(t, 'requestStatuses', request.status)} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {showDepartment && <><dt className="text-text-secondary-light">{t('common.department')}</dt><dd>{DEPARTMENT_LABELS[request.department] ?? request.department}</dd></>}
        <dt className="text-text-secondary-light">{t('card.kind')}</dt><dd>{ramp ? t('card.rampAgent') : t('card.webUser')}</dd>
        <dt className="text-text-secondary-light">{t('card.requestedBy')}</dt><dd>{request.requestedBy} · {dateFormat(request.requestedAt, locale)}</dd>
        <dt className="text-text-secondary-light">{t('common.stations')}</dt><dd>{request.stations.map(station => station.code).join(', ')}</dd>
        {(ramp || request.employeeId) && <>
          <dt className="text-text-secondary-light">{t('card.employee')}</dt><dd>{request.employeeNumber} · {request.category}</dd>
        </>}
        {!request.employeeId && <><dt className="text-text-secondary-light">{t('card.record')}</dt><dd className="text-status-warning">{t('card.noRecord')}</dd></>}
        {ramp && <>
          <dt className="text-text-secondary-light">{t('card.hireDate')}</dt><dd>{request.hireDate}</dd>
          <dt className="text-text-secondary-light">{t('card.terminals')}</dt><dd>{request.terminals.map(terminal => terminal.code).join(', ') || t('card.noTerminals')}</dd>
          <dt className="text-text-secondary-light">{t('card.supervisor')}</dt><dd>{request.supervisorName ?? t('card.noSupervisor')}</dd>
        </>}
        {!ramp && <><dt className="text-text-secondary-light">{t('common.template')}</dt><dd>{request.accessProfileName ?? t('card.customPermissions')}</dd></>}
        {request.decidedBy && <><dt className="text-text-secondary-light">{t('card.decidedBy')}</dt><dd>{request.decidedBy} · {dateFormat(request.decidedAt, locale)}</dd></>}
      </dl>
      {!ramp && permissions.length > 0 && (
        <ul className="mt-3 space-y-0.5 rounded-lg bg-black/[.03] p-3 text-xs dark:bg-white/[.04]">
          {permissions.map(label => <li key={label}>{label}</li>)}
        </ul>
      )}
      {request.status === 'Rejected' && request.decisionReason && (
        <p className="mt-3 rounded-lg bg-status-danger/10 p-3 text-xs text-status-danger">{t('card.reason', { reason: request.decisionReason })}</p>
      )}
      {children}
    </article>
  );
}
