import ReviewSection from './ReviewSection';
import { formatClockTime, hasMissingSignature } from '../reviewMappers';
import { AlertTriangleIcon } from '../../dashboard/components/icons';

export default function SignatureStatus({ operation }) {
  const signatures = operation.signatures ?? [];
  const missing = hasMissingSignature(operation);

  return (
    <ReviewSection
      title="Firmas"
      action={
        missing ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/10 px-2 py-0.5 text-xs font-semibold text-status-warning">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            Firma pendiente
          </span>
        ) : null
      }
    >
      <ul className="space-y-1.5">
        {signatures.map(signature => (
          <li
            key={`${signature.role}-${signature.name}`}
            className="flex items-center justify-between rounded-lg border border-black/5 px-3 py-1.5 dark:border-white/5"
          >
            <div>
              <p className="font-medium text-ink-900 dark:text-text-primary-dark">{signature.name}</p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{signature.role}</p>
            </div>
            <div className="text-right">
              <p
                className={`text-xs font-semibold ${
                  signature.status === 'signed' ? 'text-status-success' : 'text-status-warning'
                }`}
              >
                {signature.status === 'signed' ? 'Firmado' : 'Pendiente'}
              </p>
              {signature.timestamp && (
                <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  {formatClockTime(signature.timestamp)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </ReviewSection>
  );
}
