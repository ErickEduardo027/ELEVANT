'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import OccPopover from '../occ-ui/OccPopover';
import { formatClock } from '../occ-ui/occTime';
import { useAviationReferenceRead, useAviationReferenceService } from './AviationReferenceContext';
import { delayMinutes, delaysSummary, delayTone, statusWords, worstDelayIndex } from './aviationReferenceFormat';
import { aviationReferenceMessages } from './aviationReferenceMessages';

// The current delays of an airport from AeroDataBox (ADR-0028, note of 15 November 2026): the median delay of the
// arrivals and the departures of the two hours before, with the provider's delay index. The pill of Panorama's bottom bar
// reads the station's airport while the console is open and the tab visible, again every 15 minutes (the API keeps the
// answer an hour, so most of those reads cost nothing); the inspector reads the selected flight's other airport once.
// The Starter plan does not include the delays: the API answers `Disabled` without calling the provider, and then the
// pill and the inspector's row draw nothing and the pill stops polling.
// Without an AviationReferenceProvider nothing renders and nothing is sent. OCC tokens: both themes.

/** The pill's pace: the API keeps the delays an hour, so a quarter of an hour never spends more than one call an hour. */
export const AIRPORT_DELAYS_POLL_MS = 900_000;

const TONE = Object.freeze({
  none: 'text-occ-muted',
  ok: 'text-occ-text',
  watch: 'text-occ-warn',
  high: 'text-occ-danger',
});

/** A tick every `pollMs` while the tab is visible (null: never), so a hidden tab sends nothing. */
function useVisibleTick(pollMs) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!pollMs) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick(value => value + 1);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs]);
  return tick;
}

/**
 * The delays of `airport` (null: the station's own), read through the provider's adapter. The read is off on the
 * Starter plan (ADR-0028, note of 15 November 2026): its first answer is `Disabled`, and then the hook stops polling and
 * says it is not available, so nothing is drawn and nothing more is sent.
 */
export function useAirportDelays(stationId, airport = null, { pollMs = null } = {}) {
  const service = useAviationReferenceService();
  const [off, setOff] = useState(false);
  const tick = useVisibleTick(service && stationId && !off ? pollMs : null);
  const key = service && stationId ? `${stationId}|${airport ?? ''}|${tick}` : null;
  const read = useAviationReferenceRead(key, ({ signal }) => service.getDelays({ stationId, airport, signal }),
    { keep: pollMs !== null });
  const disabled = read.status === 'success' && read.data?.status === 'Disabled';
  useEffect(() => {
    if (disabled) setOff(true);
  }, [disabled]);
  return { available: service !== null && Boolean(stationId) && !disabled && !off, read };
}

function Batch({ t, locale, label, batch }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <h4 className="text-xs font-semibold text-occ-text">{label}</h4>
      <dl className="space-y-0.5 text-xs">
        {[
          ['median', batch.total === 0 ? t('delays.noFlights') : delayMinutes(t, batch.medianDelayMinutes) ?? '—'],
          ['index', Number.isFinite(batch.delayIndex)
            ? t('delays.indexValue', { value: batch.delayIndex.toLocaleString(locale, { maximumFractionDigits: 1 }) }) : '—'],
          ['flights', t('delays.flightsValue', { qualified: batch.qualified, total: batch.total })],
          ['cancelled', String(batch.cancelled)],
        ].map(([id, value]) => (
          <div key={id} className="flex flex-wrap gap-x-2">
            <dt className="text-occ-muted">{t(`delays.${id}`)}</dt>
            <dd className="text-occ-text">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The detail of one answer: both batches, the window, the state and the credit. */
export function AirportDelaysDetail({ read, airport }) {
  const { t, locale } = useTranslation(aviationReferenceMessages);
  const facts = read.data?.delays ?? null;
  const status = statusWords(t, read, facts !== null);
  return (
    <div data-airport-delays-detail="" className="space-y-2 text-xs">
      <h3 className="text-sm font-semibold text-occ-text">{t('delays.dialogTitle', { airport })}</h3>
      {facts && (
        <>
          <p className="text-occ-muted">
            {t('delays.window', { from: formatClock(facts.from, locale, 'UTC'), to: formatClock(facts.to, locale, 'UTC') })}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Batch t={t} locale={locale} label={t('delays.arrivalsLong')} batch={facts.arrivals} />
            <Batch t={t} locale={locale} label={t('delays.departuresLong')} batch={facts.departures} />
          </div>
        </>
      )}
      {status && <p className="text-occ-muted">{status}</p>}
      <p className="text-occ-muted">{t('delays.hint')}</p>
      <p className="text-occ-muted">{t('source')}</p>
    </div>
  );
}

/** «Demoras PUJ: llegadas +12 min · salidas +8 min», or the state of the read, in one line. */
function pillWords(t, read, label) {
  const facts = read.data?.delays ?? null;
  const summary = delaysSummary(t, facts);
  const status = read.status === 'success' && read.data?.status !== 'Available' ? t(`status.${read.data.status}`) : null;
  if (summary) return `${t('delays.pill', { airport: label })}: ${summary}${status ? ` · ${status}` : ''}`;
  if (read.status === 'loading' || read.status === 'idle') return `${t('delays.pill', { airport: label })}: …`;
  return `${t('delays.pill', { airport: label })}: ${statusWords(t, read, false) ?? '—'}`;
}

/**
 * The pill of the console's bottom bar, next to the weather: the delays of the station's airport (`label` is what it is
 * called, «PUJ»). It opens its detail above it, as the weather pill does.
 */
export function AirportDelaysPill({ stationId, label = 'PUJ', className = '' }) {
  const { t } = useTranslation(aviationReferenceMessages);
  const { available, read } = useAirportDelays(stationId, null, { pollMs: AIRPORT_DELAYS_POLL_MS });
  if (!available) return null;
  const tone = delayTone(worstDelayIndex(read.data?.delays));
  return (
    <OccPopover className={className} align="end" panelLabel={t('delays.dialogTitle', { airport: label })}
      triggerClassName={`inline-flex min-h-8 max-w-full items-center gap-2 rounded border border-occ-line px-2 text-xs hover:bg-occ-panel-raised [@media(pointer:coarse)]:min-h-11 ${TONE[tone]}`}
      panelClassName="!top-auto bottom-full !mt-0 mb-2 w-[min(28rem,calc(100vw_-_2rem))]"
      trigger={<span data-airport-delays-pill={read.data?.status ?? read.status} className="truncate">{pillWords(t, read, label)}</span>}>
      <AirportDelaysDetail read={read} airport={label} />
    </OccPopover>
  );
}

/**
 * The delays of the selected flight's other airport in the inspector (`role`: 'origin' for an arrival, 'destination' for
 * a departure). Read once per airport while the flight stays selected.
 */
export function AirportDelaysLine({ stationId, airport, role = 'origin', className = '' }) {
  const { t } = useTranslation(aviationReferenceMessages);
  const code = typeof airport === 'string' && /^[A-Za-z]{3,4}$/.test(airport.trim()) ? airport.trim().toUpperCase() : null;
  const { available, read } = useAirportDelays(code ? stationId : null, code);
  if (!available || !code) return null;
  const facts = read.data?.delays ?? null;
  const summary = delaysSummary(t, facts);
  const status = statusWords(t, read, summary !== null);
  return (
    <section data-airport-delays-line={read.data?.status ?? read.status}
      className={`space-y-0.5 border-t border-occ-line pt-2 text-xs ${className}`.trim()}>
      <h3 className="font-semibold text-occ-text">{t(`delays.${role === 'destination' ? 'destination' : 'origin'}`, { airport: code })}</h3>
      {summary && <p className={TONE[delayTone(worstDelayIndex(facts))]}>{summary}</p>}
      {status && <p className="text-occ-muted">{status}</p>}
    </section>
  );
}
