import ReviewSection from './ReviewSection';
import { formatClockTime, formatOperationDate } from '../reviewMappers';

export default function ObservationList({ observations = [] }) {
  return (
    <ReviewSection title="Observaciones">
      {observations.length === 0 ? (
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin observaciones registradas.</p>
      ) : (
        <ul className="space-y-2">
          {observations.map((observation, index) => (
            <li key={index} className="rounded-lg border border-black/5 p-3 dark:border-white/5">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {observation.user} · {observation.role} · {formatOperationDate(observation.at)} {formatClockTime(observation.at)}
              </p>
              <p className="mt-1 text-ink-900 dark:text-text-primary-dark">{observation.comment}</p>
            </li>
          ))}
        </ul>
      )}
    </ReviewSection>
  );
}
