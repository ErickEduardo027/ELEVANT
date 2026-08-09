import ReviewSection from './ReviewSection';
import { formatClockTime } from '../reviewMappers';
import { AlertTriangleIcon } from '../../dashboard/components/icons';

const SEVERITY_META = {
  low: { label: 'Baja', className: 'bg-status-info/10 text-status-info' },
  medium: { label: 'Media', className: 'bg-status-warning/10 text-status-warning' },
  high: { label: 'Alta', className: 'bg-status-danger/10 text-status-danger' },
  critical: { label: 'Crítica', className: 'bg-status-danger/10 text-status-danger' },
};

export default function IncidentList({ incidents = [] }) {
  return (
    <ReviewSection
      title="Incidencias y observaciones"
      action={
        incidents.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-danger/10 px-2 py-0.5 text-xs font-semibold text-status-danger">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            {incidents.length}
          </span>
        ) : null
      }
    >
      {incidents.length === 0 ? (
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin incidencias reportadas.</p>
      ) : (
        <ul className="space-y-2">
          {incidents.map(incident => {
            const severity = SEVERITY_META[incident.severity] ?? SEVERITY_META.low;
            return (
              <li key={incident.id} className="rounded-xl border border-status-danger/20 bg-status-danger/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ink-900 dark:text-text-primary-dark">{incident.description}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${severity.className}`}>
                    {severity.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  Reportado por {incident.reportedBy} · {formatClockTime(incident.occurredAt)}
                </p>
                {incident.observation && (
                  <p className="mt-1 text-xs text-ink-900 dark:text-text-primary-dark">{incident.observation}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ReviewSection>
  );
}
