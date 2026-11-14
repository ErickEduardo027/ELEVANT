import { useSyncExternalStore } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import OccGlyph from '../../occ-ui/OccGlyph';
import { httpsUrl } from '../core/attribution';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';

// The state of the air traffic over an OCC map (design A7) and the credit of its source (owner decision 6). The chip
// sits at the top centre of the visible area, under the base-map notice when both show; the credit «Datos de
// aeronaves: adsb.fi» (a link) sits at its bottom left whenever traffic is on screen: the map's attribution keeps the
// same credit, but folded. The air picture's state (Live, Stale, Warming, Unavailable, Disabled) is data, never an
// error, and its reason is said in the screen's words: the server's text is never shown. The chip speaks of the air
// picture alone, as the shell's list of sources does: each read of the map fails alone (contracts 1.3), so a failed
// read of the AVIAM flights has a notice of its own, under the chip.

const SECOND_MS = 1_000;
// The same two signals as the shell's list of sources (admin-occ/shell/status/OccSourcesButton.jsx).
const SIGNALS = Object.freeze({ delayed: 'attention', unavailable: 'urgent' });
const LOADING = Object.freeze({ kind: 'loading', reason: null, ageS: null, retry: false });

/**
 * How old the last data of `picture` (the air picture model) is at `nowMs`, the server's time, in seconds: its age when
 * the server answered, plus the time since. Without `nowMs`, its age when the server answered.
 */
export function pictureAgeSeconds(picture, nowMs = null) {
  const since = Number.isFinite(nowMs) && Number.isFinite(picture?.serverTime) ? Math.max(0, nowMs - picture.serverTime) : 0;
  return (Number.isFinite(picture?.ageSeconds) ? picture.ageSeconds : 0) + since / SECOND_MS;
}

const lateChip = (picture, nowMs) => ({ kind: 'delayed', reason: null, ageS: pictureAgeSeconds(picture, nowMs), retry: false });

/**
 * The chip a map shows for its air traffic, or `null` when all is well or nothing is read: `{ kind, reason, ageS,
 * retry }` with `kind` one of loading, empty, unavailable, forbidden, delayed. It speaks of the air picture alone, never
 * of the AVIAM flights. From useMapSituation, `picture` (the air picture model, null while its read has nothing to show)
 * and `sourceState` (what the shell's list of sources says of the air traffic, from the picture's read alone) decide
 * it; `status`, the map's state, only says whether the map reads at all (`idle`) and, without a picture, whether its
 * reads are still on the way. A read that failed (`offline`) offers to try again, a station without live traffic
 * (`unconfigured`) reads as an environment without the source, a refused read (`forbidden`) as an access without live
 * traffic, and a Live picture whose last refresh failed (`delayed`) is late. `nowMs` (the server's time) ages a late
 * picture.
 */
export function sourceChip({ status = 'idle', picture = null, sourceState = null, nowMs = null } = {}) {
  if (status === 'idle') return null;
  if (sourceState === 'forbidden') return { kind: 'forbidden', reason: null, ageS: null, retry: false };
  if (picture === null) {
    if (sourceState === 'offline') return { kind: 'unavailable', reason: null, ageS: null, retry: true };
    if (sourceState === 'unconfigured') return { kind: 'unavailable', reason: 'not_configured', ageS: null, retry: false };
    // The picture has not answered yet, whatever the AVIAM flights did.
    return status === 'success' || status === 'empty' ? null : LOADING;
  }
  const reason = picture.reason ?? null;
  switch (picture.status) {
    case 'Warming': return LOADING;
    case 'Unavailable': return { kind: 'unavailable', reason, ageS: null, retry: true };
    case 'Disabled': return { kind: 'unavailable', reason, ageS: null, retry: false };
    case 'Stale': return lateChip(picture, nowMs);
    case 'Live':
      if (sourceState === 'delayed') return lateChip(picture, nowMs);
      return picture.aircraft.length === 0 ? { kind: 'empty', reason: null, ageS: null, retry: false } : null;
    default: return null;
  }
}

// A tick every second while the tab shows: the chip listens to it only while it says the traffic is late. Hidden,
// nothing runs, and the tab showing again ticks at once.
function subscribeSeconds(listener) {
  let timer = null;
  const start = () => {
    if (timer === null) timer = setInterval(listener, SECOND_MS);
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      stop();
      return;
    }
    listener();
    start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState !== 'hidden') start();
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
const noSubscription = () => () => {};
const noTime = () => null;

/**
 * The time of `clock` (the map's server clock, src/services/serverClock.js: `now()` in milliseconds) to the second,
 * read again every second while `ticking`; `null` otherwise. A late picture ages with it between two of its reads,
 * never from the instant of the last answer.
 */
function useClockSecond(clock, ticking) {
  const live = ticking && typeof clock?.now === 'function';
  const read = live ? () => Math.floor(clock.now() / SECOND_MS) * SECOND_MS : noTime;
  return useSyncExternalStore(live ? subscribeSeconds : noSubscription, read, noTime);
}

function ageWords(t, ageS) {
  const seconds = Math.max(0, Math.floor(ageS ?? 0));
  return seconds < 60 ? t('source.ageSeconds', { count: seconds }) : t('source.ageMinutes', { count: Math.floor(seconds / 60) });
}

/** One chip over the map: its signal, its words and their reason, and «Reintentar» when `onRetry` is a function. */
function Chip({ label, signal = null, words, reason = null, retryLabel, onRetry = null, ...data }) {
  return (
    <div role="status" aria-label={label} {...data}
      className="occ-map-source-chip flex items-start gap-3 rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
      {signal !== null && <OccGlyph name={signal} className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0">
        <span className="block">{words}</span>
        {reason !== null && <span className="block text-occ-muted">{reason}</span>}
      </span>
      {typeof onRetry === 'function' && (
        <button type="button" onClick={onRetry}
          className="min-h-9 shrink-0 rounded border border-occ-line bg-occ-panel px-3 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised">
          {retryLabel}
        </button>
      )}
    </div>
  );
}

function Credit({ source, label }) {
  const name = source.name.trim();
  const home = httpsUrl(source.homeUrl);
  const license = typeof source.licenseName === 'string' && source.licenseName.trim() !== '' ? source.licenseName.trim() : null;
  const licenseHref = httpsUrl(source.licenseUrl);
  const link = (href, text) => (href === null ? text : <a href={href} target="_blank" rel="noopener noreferrer" className="text-occ-accent underline-offset-2 hover:underline">{text}</a>);
  return (
    <p data-map-credit className="occ-map-credit rounded-sm bg-occ-panel-float px-2 py-1 text-xs text-occ-muted">
      {label}: {link(home, name)}
      {license !== null && <> ({link(licenseHref, license)})</>}
    </p>
  );
}

/**
 * The traffic state of an OccMap, inside it (it reads the traffic on screen and its source from OccMapContext):
 * «Cargando tráfico…», «No hay aviones en la zona», «No hay tráfico en vivo en este momento.» with the reason and
 * «Reintentar», «Tu acceso no incluye el tráfico en vivo.», «Tráfico con retraso: último dato hace 4 min.», and the
 * credit line while traffic is on screen. Props as sourceChip takes them, plus:
 * - `clock`: the map's server clock (useMapSituation's `clock`). While the chip says the traffic is late, its age is
 *   counted with it, second by second; without one, at the fixed `nowMs` (the map lab's frozen instant);
 * - `onRetry`: what «Reintentar» does (useMapSituation's `retry`).
 * When the map's `status` is `error` (useMapSituation: the read of the AVIAM flights failed, with nothing to show) a
 * notice of its own, under the chip, says «No se pudieron cargar los vuelos de AVIAM.» with «Reintentar»: the traffic
 * may still be live. Nothing to say, nothing rendered.
 */
export default function MapSourceStatus({ status = 'idle', picture = null, sourceState = null, nowMs = null, clock = null,
  onRetry }) {
  const { t } = useTranslation(mapMessages);
  const { trafficSource, engineStatus } = useOccMap();
  const chip = sourceChip({ status, picture, sourceState, nowMs });
  const clockSecond = useClockSecond(clock, chip?.kind === 'delayed');
  const ageS = clockSecond === null ? chip?.ageS : pictureAgeSeconds(picture, clockSecond);
  const flightsFailed = status === 'error';
  const credit = trafficSource !== null && engineStatus !== 'unavailable' ? trafficSource : null;
  if (chip === null && !flightsFailed && credit === null) return null;

  let words = null;
  if (chip?.kind === 'delayed') words = t('source.delayed', { age: ageWords(t, ageS) });
  else if (chip !== null) words = t(`source.${chip.kind}`);
  const reason = chip?.reason ? t(`source.reason.${chip.reason}`) : null;

  return (
    <div data-testid="map-source-status" className="occ-map-source-status">
      {(chip !== null || flightsFailed) && (
        <div className="occ-map-source-chips">
          {chip !== null && (
            <Chip label={t('source.label')} signal={SIGNALS[chip.kind] ?? null} words={words} reason={reason}
              retryLabel={t('source.retry')} onRetry={chip.retry ? onRetry : null} data-source-chip={chip.kind} />
          )}
          {flightsFailed && (
            <Chip label={t('source.flights.label')} signal={SIGNALS.unavailable} words={t('source.flights.unavailable')}
              retryLabel={t('source.retry')} onRetry={onRetry} data-flights-notice="unavailable" />
          )}
        </div>
      )}
      {credit !== null && <Credit source={credit} label={t('attribution.aircraftData')} />}
    </div>
  );
}
