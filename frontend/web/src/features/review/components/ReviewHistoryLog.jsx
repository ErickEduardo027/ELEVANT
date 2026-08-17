import ReviewSection from './ReviewSection';
import { formatClockTime } from '../reviewMappers';
import { HistoryIcon } from './icons';

export default function ReviewHistoryLog({ history = [] }) {
  return (
    <ReviewSection title="Historial">
      {history.length === 0 ? (
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin eventos registrados.</p>
      ) : (
        <ol className="space-y-2">
          {history.map((entry, index) => (
            <li key={index} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-600/10 text-accent-600">
                <HistoryIcon className="h-3 w-3" />
              </span>
              <div>
                <p className="text-ink-900 dark:text-text-primary-dark">
                  <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {formatClockTime(entry.at)}
                  </span>{' '}
                  {entry.action}
                  {entry.user ? ` — ${entry.user}` : ''}
                </p>
                {entry.comment && (
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{entry.comment}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </ReviewSection>
  );
}
