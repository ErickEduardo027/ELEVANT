import FlightStripCard from './FlightStripCard';
import { mapAlertToStrip } from '../mappers';

export default function AlertsFeed({ alerts, loading = false }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
        Alertas y notificaciones
      </h2>

      {loading ? (
        <div data-testid="alerts-skeleton" className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-black/5 dark:bg-white/5" />
          ))}
        </div>
      ) : (
        <div data-testid="alerts-scroll" className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {alerts.slice(0, 6).map(alert => {
            const strip = mapAlertToStrip(alert);
            return (
              <FlightStripCard
                key={strip.key}
                accentColor={strip.accentColor}
                primary={strip.primary}
                meta={strip.meta}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
