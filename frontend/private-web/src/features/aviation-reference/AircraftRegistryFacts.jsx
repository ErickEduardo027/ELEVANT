'use client';

import { normalizedRegistration } from '@elevant/api-client';
import { useTranslation } from '../../i18n/LanguageScope';
import { formatClock } from '../occ-ui/occTime';
import { isDemoRegistration } from '../../services/aviationReferenceService';
import { useAviationReferenceRead, useAviationReferenceService } from './AviationReferenceContext';
import { aircraftRows, statusWords } from './aviationReferenceFormat';
import { aviationReferenceMessages } from './aviationReferenceMessages';

// What AeroDataBox knows of an aircraft by its registration (ADR-0028, note of 15 November 2026): model, type, operator,
// age and first flight, seats and engines, and whether the registration exists. It reads when it mounts with a
// registration, which happens when a flight is selected on an OCC map or in the import dialog: demand-driven, one
// request per registration (the API keeps it a day, the tab an hour). A demo flight (`isDemo`, or a synthetic
// «HIDM..» registration) is never asked. Without an AviationReferenceProvider it renders nothing. OCC tokens: both themes.

export default function AircraftRegistryFacts({ stationId, registration, isDemo = false, className = '' }) {
  const service = useAviationReferenceService();
  const { t, locale } = useTranslation(aviationReferenceMessages);
  const tail = normalizedRegistration(registration);
  const demo = isDemo === true || (tail !== null && isDemoRegistration(tail));
  const key = service && stationId && tail && !demo ? `${stationId}|${tail}` : null;
  const read = useAviationReferenceRead(key, ({ signal }) => service.getAircraft({ stationId, registration: tail, signal }));
  if (!service || !tail || !stationId) return null;
  if (demo) {
    return (
      <p data-aircraft-facts="demo" className={`text-xs text-occ-muted ${className}`.trim()}>{t('status.NotApplicable')}</p>
    );
  }

  const answer = read.data;
  const aircraft = answer?.aircraft ?? null;
  const rows = aircraftRows(t, aircraft, locale);
  const notFound = answer?.status === 'NotFound';
  const status = notFound ? null : statusWords(t, read, aircraft !== null);
  return (
    <section data-aircraft-facts={aircraft ? 'facts' : notFound ? 'not-found' : read.status} aria-live="polite"
      className={`space-y-1 border-t border-occ-line pt-2 text-xs ${className}`.trim()}>
      <h3 className="flex flex-wrap items-center gap-1.5 font-semibold text-occ-text">
        <span>{t('aircraft.title', { registration: aircraft?.registration ?? tail })}</span>
        {aircraft && (
          <span className="rounded-sm border border-occ-line-strong px-1 leading-4 text-occ-muted">
            {aircraft.active ? t('aircraft.active') : t('aircraft.inactive')}
          </span>
        )}
        {aircraft?.isFreighter && (
          <span className="rounded-sm border border-occ-line-strong px-1 leading-4 text-occ-muted">{t('aircraft.freighter')}</span>
        )}
      </h3>
      {rows.length > 0 && (
        <dl className="space-y-0.5">
          {rows.map(row => (
            <div key={row.id} className="flex gap-3" data-aircraft-row={row.id}>
              <dt className="w-24 shrink-0 text-occ-muted">{row.label}</dt>
              <dd className="min-w-0 flex-1 text-occ-text [overflow-wrap:anywhere]">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {notFound && <p className="text-occ-text">{t('aircraft.notFound', { registration: tail })}</p>}
      {status && <p className="text-occ-muted">{status}</p>}
      {aircraft && answer?.retrievedAt && (
        <p className="text-occ-muted">
          <time dateTime={answer.retrievedAt}>{t('retrieved', { time: formatClock(answer.retrievedAt, locale, 'UTC') })}</time>
          {' UTC'}
        </p>
      )}
    </section>
  );
}
