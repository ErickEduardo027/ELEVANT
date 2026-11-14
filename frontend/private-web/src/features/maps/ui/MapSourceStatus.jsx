import { useTranslation } from '../../../i18n/LanguageScope';
import OccGlyph from '../../occ-ui/OccGlyph';
import { httpsUrl } from '../core/attribution';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';

// The state of the air traffic over an OCC map (design A7) and the credit of its source (owner decision 6). The chip
// sits at the top centre of the visible area, under the base-map notice when both show; the credit «Datos de
// aeronaves: adsb.fi» (a link) sits at its bottom left whenever traffic is on screen: the map's attribution keeps the
// same credit, but folded. The air picture's state (Live, Stale, Warming, Unavailable, Disabled) is data, never an
// error, and its reason is said in the screen's words: the server's text is never shown.

const SECOND_MS = 1_000;
// The same two signals as the shell's list of sources (admin-occ/shell/status/OccSourcesButton.jsx).
const SIGNALS = Object.freeze({ delayed: 'attention', unavailable: 'urgent' });

/**
 * The chip a map shows for its air traffic, or `null` when all is well or nothing is read: `{ kind, reason, ageS,
 * retry }` with `kind` one of loading, empty, unavailable, forbidden, delayed. From useMapSituation: `status` (its
 * five states and idle), `picture` (the air picture model), `sourceState` (what the shell's source list says) and
 * `refreshFailed`; `nowMs` (the server's time) ages a picture that a failed refresh left behind.
 */
export function sourceChip({ status = 'idle', picture = null, sourceState = null, refreshFailed = false, nowMs = null } = {}) {
  if (status === 'idle') return null;
  if (status === 'unauthorized' || sourceState === 'forbidden') return { kind: 'forbidden', reason: null, ageS: null, retry: false };
  if (status === 'loading') return { kind: 'loading', reason: null, ageS: null, retry: false };
  if (status === 'error') return { kind: 'unavailable', reason: null, ageS: null, retry: true };
  if (picture === null) return null;
  const reason = picture.reason ?? null;
  const since = Number.isFinite(nowMs) && Number.isFinite(picture.serverTime) ? Math.max(0, nowMs - picture.serverTime) : 0;
  const ageS = (Number.isFinite(picture.ageSeconds) ? picture.ageSeconds : 0) + since / SECOND_MS;
  switch (picture.status) {
    case 'Warming': return { kind: 'loading', reason: null, ageS: null, retry: false };
    case 'Unavailable': return { kind: 'unavailable', reason, ageS: null, retry: true };
    case 'Disabled': return { kind: 'unavailable', reason, ageS: null, retry: false };
    case 'Stale': return { kind: 'delayed', reason: null, ageS, retry: false };
    case 'Live':
      if (refreshFailed) return { kind: 'delayed', reason: null, ageS, retry: false };
      return picture.aircraft.length === 0 ? { kind: 'empty', reason: null, ageS: null, retry: false } : null;
    default: return null;
  }
}

function ageWords(t, ageS) {
  const seconds = Math.max(0, Math.floor(ageS ?? 0));
  return seconds < 60 ? t('source.ageSeconds', { count: seconds }) : t('source.ageMinutes', { count: Math.floor(seconds / 60) });
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
 * credit line while traffic is on screen. Props as sourceChip takes them, plus `onRetry`. Nothing to say, nothing
 * rendered.
 */
export default function MapSourceStatus({ status = 'idle', picture = null, sourceState = null, refreshFailed = false,
  nowMs = null, onRetry }) {
  const { t } = useTranslation(mapMessages);
  const { trafficSource, engineStatus } = useOccMap();
  const chip = sourceChip({ status, picture, sourceState, refreshFailed, nowMs });
  const credit = trafficSource !== null && engineStatus !== 'unavailable' ? trafficSource : null;
  if (chip === null && credit === null) return null;

  let words = null;
  if (chip?.kind === 'delayed') words = t('source.delayed', { age: ageWords(t, chip.ageS) });
  else if (chip !== null) words = t(`source.${chip.kind}`);
  const reason = chip?.reason ? t(`source.reason.${chip.reason}`) : null;
  const signal = chip === null ? null : SIGNALS[chip.kind] ?? null;

  return (
    <div data-testid="map-source-status" className="occ-map-source-status">
      {chip !== null && (
        <div role="status" aria-label={t('source.label')} data-source-chip={chip.kind}
          className="occ-map-source-chip flex items-start gap-3 rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
          {signal !== null && <OccGlyph name={signal} className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="min-w-0">
            <span className="block">{words}</span>
            {reason !== null && <span className="block text-occ-muted">{reason}</span>}
          </span>
          {chip.retry && onRetry && (
            <button type="button" onClick={onRetry}
              className="min-h-9 shrink-0 rounded border border-occ-line bg-occ-panel px-3 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised">
              {t('source.retry')}
            </button>
          )}
        </div>
      )}
      {credit !== null && <Credit source={credit} label={t('attribution.aircraftData')} />}
    </div>
  );
}
