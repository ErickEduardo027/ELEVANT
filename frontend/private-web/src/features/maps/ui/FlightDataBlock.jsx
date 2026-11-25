'use client';

import Link from 'next/link';
import { useTranslation } from '../../../i18n/LanguageScope';
import { parseInstant } from '../../../services/serverClock';
import { normalizeStandCode } from '../../../services/standCodes';
import OccPlate from '../../occ-ui/OccPlate';
import OccStandSwatch from '../../occ-ui/OccStandSwatch';
import { useOccMap } from '../core/OccMapContext';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { STATUS_MESSAGES, formatTimeScale, kinematicsMessages, timeScaleMessage } from '../kinematics/kinematicsMessages';
import { mapMessages } from '../mapMessages';
import { staleWords, stationTime } from '../traffic/stationTime';
import { telemetryAt, useServerTime, useTelemetry } from '../traffic/telemetryStore';

// The data block of the chosen aircraft (design E4, Decision E-1): a card docked in a corner of the map, never a popup
// pinned to the aircraft, so it covers no traffic and React does not follow the aircraft on screen. It is a dialog
// without aria-modal (the map keeps its keys) named with the flight number. Its telemetry comes from the map's
// telemetry store (traffic/telemetryStore.js) through useSyncExternalStore, so the age of a live position counts up
// while the map does not re-render. It always says where the position comes from: live, without a signal for N s
// (PR M6: the fix carried on), not updated since the station's time of its last position (the stale tag of the
// vocabulary, as the aircraft's tag says it), estimated from the schedule, or none yet; «Vuelo demo» and «Sin
// importar» when they apply. Its times are the station's.
//
// PR M6 adds what the motion knows: the status of a demo flight's plan («Esperando posición · sin importar»,
// «Esperando posición», «Cancelado por el proveedor (demo)»), «Demo acelerada ×N» while the part the aircraft is in had
// to be scaled, and the runway a real flight's estimated path uses with where that choice comes from («por el
// tráfico», «habitual»; the wind with PR M8). A demo flight always names runway 08 (contracts 2.3). «Seguir» (follow
// mode, design A6) is its first action when the screen gives one: the same switch as the S key and the dock's button.

/** A demo flight always lands and departs on runway 08 (owner decision 19, contracts 2.3). */
export const DEMO_RUNWAY = '08';
// Below this vertical rate the aircraft is level: no «subiendo» or «bajando».
const LEVEL_FPM = 300;
// Within this of now a time is «ahora».
const NOW_MS = 30_000;
const STEP_MS = 5_000;

const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** What the card calls the aircraft: the flight number, else the callsign, else the ADS-B address. */
export function dataBlockIdentifier(target) {
  const { flight, aircraft } = target ?? {};
  return text(flight?.flightNumber) ?? text(aircraft?.flightNumber) ?? text(aircraft?.callsign) ?? text(flight?.callsign)
    ?? (text(aircraft?.hex)?.toUpperCase() ?? '—');
}

/**
 * The pages the card links to (contracts 2.1: `flightId` takes a leg id or a flightKey, `stand` the normalized code):
 * `{ turnaround: href | null, stand: href | null }`. The turnaround is there only for an imported flight; the stand when
 * the flight has one (assigned, or suggested for a demo flight not yet imported). `stationId` is kept in both.
 */
export function dataBlockLinks(flight, { stationId = null } = {}) {
  if (!flight) return { turnaround: null, stand: null };
  const query = values => new URLSearchParams({ ...(text(stationId) ? { stationId } : {}), ...values }).toString();
  const flightId = text(flight.legId) ?? text(flight.flightKey);
  const code = text(flight.stand?.code) ?? text(flight.suggestedStandCode);
  return {
    turnaround: flight.imported === true && flightId ? `/admin-occ/planning?${query({ flightId })}` : null,
    stand: code ? `/admin-occ/positions-map?${query({ stand: normalizeStandCode(code) })}` : null,
  };
}

function durationText(ms, t) {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  if (minutes < 60) return t('dataBlock.minutes', { count: Math.max(1, minutes) });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t('dataBlock.hours', { hours }) : t('dataBlock.hoursMinutes', { hours, minutes: rest });
}

function relativeText(at, nowMs, t) {
  if (!finite(nowMs)) return null;
  const delta = at - nowMs;
  if (Math.abs(delta) < NOW_MS) return t('dataBlock.now');
  return t(delta > 0 ? 'dataBlock.in' : 'dataBlock.ago', { duration: durationText(delta, t) });
}

// The provider's words for an arrival that is down (contracts 1.3), which may come before any time does.
const LANDED_PHASES = new Set(['landed', 'arrived']);

/**
 * Whether a departure has left: it has its runway time, or the provider says `departed` (contracts 1.3) before it
 * gives one. The time line and the stand line read it the same way.
 */
const hasLeft = flight => flight.direction === 'Departure'
  && (flight.phase === 'departed' || parseInstant(flight.actualAt ?? null) !== null);

// The recorded time of a milestone of the flight's operation (contracts 1.3), or null.
function milestoneAt(flight, code) {
  const milestone = Array.isArray(flight.milestones)
    ? flight.milestones.find(item => item?.code === code && item.actualAt != null)
    : null;
  return milestone ? parseInstant(milestone.actualAt) : null;
}

/**
 * The time line of a flight at `nowMs`: `{ words, at, relative }` («Llega 11:10» and «en 10 min»), or the words of a
 * cancelled or diverted flight alone. It never speaks in the future of what has happened, nor of a time gone by:
 * - with a time of what happened: an arrival landed (its runway time) or reached its stand (its on-block time,
 *   `actualKind: 'OnBlock'`, else a recorded BLOCK_ON); a departure left (its runway time);
 * - when the provider says so before it gives a time (an arrival `landed` or `arrived`, a departure `departed`): the
 *   same verb with the planned time, named as such, and no count that would date it («Aterrizó · hora prevista 11:10»);
 * - a planned time gone by is overdue («Debía llegar 11:10 · hace 5 min»); one still to come, «Llega 11:10 · en 10 min».
 */
export function flightTimeLine(flight, nowMs, { t, locale }) {
  if (!flight) return null;
  if (flight.isDemo === true && flight.demo?.state === 'Cancelled') return { words: t('dataBlock.cancelledDemo'), at: null, relative: null };
  if (flight.phase === 'cancelled') return { words: t('dataBlock.cancelled'), at: null, relative: null };
  if (flight.phase === 'diverted') return { words: t('dataBlock.diverted'), at: null, relative: null };
  const arrival = flight.direction !== 'Departure';
  const line = (key, at, relative = relativeText(at, nowMs, t)) => ({
    words: t(key, { time: stationTime(at, locale) }), at, relative,
  });
  const actual = parseInstant(flight.actualAt ?? null);
  if (actual !== null) {
    if (!arrival) return line('dataBlock.departed', actual);
    return line(flight.actualKind === 'OnBlock' ? 'dataBlock.onBlock' : 'dataBlock.landed', actual);
  }
  const onBlock = arrival ? milestoneAt(flight, 'BLOCK_ON') : null;
  if (onBlock !== null) return line('dataBlock.onBlock', onBlock);
  const planned = parseInstant(flight.estimatedAt ?? null) ?? parseInstant(flight.scheduledAt ?? null);
  if (planned === null) return null;
  if (arrival ? LANDED_PHASES.has(flight.phase) : hasLeft(flight)) {
    return line(arrival ? 'dataBlock.landedPlanned' : 'dataBlock.departedPlanned', planned, null);
  }
  if (finite(nowMs) && nowMs - planned >= NOW_MS) {
    return line(arrival ? 'dataBlock.overdueArrival' : 'dataBlock.overdueDeparture', planned);
  }
  return line(arrival ? 'dataBlock.arrives' : 'dataBlock.departs', planned);
}

function ageWords(ageS, t) {
  const seconds = Math.max(0, Math.floor(finite(ageS) ? ageS : 0));
  return seconds < 60 ? t('dataBlock.seconds', { count: seconds }) : t('dataBlock.minutes', { count: Math.floor(seconds / 60) });
}

/**
 * Where the position comes from (contracts 2.4): `{ kind: 'live' | 'coast' | 'stale' | 'estimated' | 'none', words }`
 * — «En vivo · hace 4 s»; «Sin señal desde hace 20 s» while the last fix is carried on without a new one (PR M6:
 * kinematics/handoff.js, mode 'coast', `tk` the kinematics messages); «Sin actualizar desde las 10:59», the stale tag of
 * the vocabulary with the station's time of the last position (`telemetry.positionAt`), the words the aircraft's tag
 * says, as soon as the position is older than the map's stale limit or the whole picture is late; «Posición estimada:
 * calculada con el horario, no con señal del avión.»; or «Sin posición todavía».
 */
export function sourceLine(telemetry, { t, language, tk = null }) {
  if (!telemetry) return { kind: 'none', words: t('dataBlock.noPosition') };
  if (telemetry.quality === 'estimated') {
    return { kind: 'estimated', words: TAGS.estimated.description[language] ?? TAGS.estimated.description.es };
  }
  if (telemetry.quality === 'reported') {
    return { kind: 'reported', words: t('dataBlock.reported', { stand: telemetry.parkedStand ?? '—' }) };
  }
  if (telemetry.quality === 'stale') return { kind: 'stale', words: staleWords(telemetry.positionAt, language) };
  if (telemetry.mode === 'coast' && tk !== null) {
    return { kind: 'coast', words: tk(STATUS_MESSAGES.noSignal, { seconds: Math.max(0, Math.floor(telemetry.ageS ?? 0)) }) };
  }
  return { kind: 'live', words: t('dataBlock.live', { age: ageWords(telemetry.ageS, t) }) };
}

// The statuses of a plan the card says in a line of their own (a demo flight that waits or was cancelled); «Sin señal»
// is the source line's.
const PLAN_STATUSES = new Set(['awaitingStandNotImported', 'awaitingStand', 'cancelledByProvider']);

/** The line of the plan's status (PR M6, kinematicsMessages.js), or `null`. */
export function statusLine(telemetry, tk) {
  const key = telemetry?.statusKey ?? null;
  return PLAN_STATUSES.has(key) ? tk(STATUS_MESSAGES[key]) : null;
}

/** «Demo acelerada ×1,02» while the part of its plan the aircraft is in had to be scaled, or `null` in real time. */
export function timeScaleLine(telemetry, tk, language) {
  const scale = telemetry?.timeScale;
  const message = timeScaleMessage(scale);
  return message === null ? null : tk(message, { factor: formatTimeScale(scale, language) });
}

// The mark before the source line: a solid dot live, a hollow ring without a signal, the dimmed swatch with its clock
// stale, the dashed swatch estimated and a faint ring without a position. Shapes, never hues.
function SourceMark({ kind }) {
  if (kind === 'stale') return <OccStandSwatch tag="stale" />;
  if (kind === 'estimated') return <OccStandSwatch tag="estimated" />;
  let style = { fill: 'none', stroke: 'var(--occ-faint)', strokeWidth: 1.2 };
  if (kind === 'live' || kind === 'reported') style = { fill: 'var(--occ-text)' };
  if (kind === 'coast') style = { fill: 'none', stroke: 'var(--occ-text)', strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 24 16" aria-hidden="true" focusable="false" data-source-mark={kind} className="h-4 w-6 shrink-0">
      <circle cx="12" cy="8" r="3.5" style={style} />
    </svg>
  );
}

function Telemetry({ telemetry, t, locale }) {
  const unknown = '—';
  let altitude = unknown;
  let trend = null;
  if (telemetry?.onGround) altitude = t('dataBlock.ground');
  else if (finite(telemetry?.altFt)) {
    altitude = `${new Intl.NumberFormat(locale).format(telemetry.altFt)} ft`;
    if (telemetry.vrate >= LEVEL_FPM) trend = t('dataBlock.climbing');
    else if (telemetry.vrate <= -LEVEL_FPM) trend = t('dataBlock.descending');
  }
  const cells = [
    ['altitude', altitude, trend],
    ['speed', finite(telemetry?.gsKt) ? `${telemetry.gsKt} kt` : unknown, null],
    ['track', finite(telemetry?.trackDeg) ? `${String(telemetry.trackDeg).padStart(3, '0')}°` : unknown, null],
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-3 border-t border-occ-line pt-2">
      {cells.map(([key, value, note]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs text-occ-muted">{t(`dataBlock.${key}`)}</dt>
          <dd className="text-sm text-occ-text">
            <span className="font-semibold tabular-nums">{value}</span>
            {note !== null && <span className="block text-xs text-occ-muted">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Where a real flight's runway comes from (airport/runwayInUse.js `source`): the words the card adds to it.
const RUNWAY_SOURCES = new Set(['live', 'wind', 'default']);

/**
 * The stand and runway line of an ELEVANT flight: «Posición A5 · Pista 08»; a departure that has left says where from.
 * A demo flight always names 08 (contracts 2.3); a real flight the runway its estimated path uses (PR M6, from the
 * telemetry: `runwayIdent`, `runwaySource`) with where that choice comes from, «Pista 08 (por el tráfico)», and none
 * while the map has no path for it.
 */
export function standWords(flight, t, telemetry = null) {
  if (!flight) return null;
  const assigned = text(flight.stand?.code);
  const suggested = text(flight.suggestedStandCode);
  let stand = t('dataBlock.noStand');
  if (assigned) stand = t(hasLeft(flight) ? 'dataBlock.leftStand' : 'dataBlock.stand', { code: normalizeStandCode(assigned) });
  else if (suggested) stand = t('dataBlock.suggestedStand', { code: normalizeStandCode(suggested) });
  if (flight.isDemo === true) return `${stand} · ${t('dataBlock.runway', { id: DEMO_RUNWAY })}`;
  const runway = text(telemetry?.runwayIdent);
  if (runway === null) return stand;
  const source = RUNWAY_SOURCES.has(telemetry?.runwaySource) ? telemetry.runwaySource : null;
  const words = source === null ? t('dataBlock.runway', { id: runway })
    : t('dataBlock.runwayFrom', { id: runway, source: t(`dataBlock.runwaySource.${source}`) });
  return `${stand} · ${words}`;
}

const ACTION = 'inline-flex min-h-9 items-center rounded border border-occ-line bg-occ-panel px-3 text-sm font-semibold '
  + 'text-occ-text hover:bg-occ-panel-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent';
const ACTION_OFF = 'inline-flex min-h-9 cursor-not-allowed items-center rounded border border-occ-line px-3 text-sm '
  + 'font-semibold text-occ-faint';
// «Seguir» while it follows: pressed, with the cyan frame of a pressed view.
const ACTION_ON = 'inline-flex min-h-9 items-center rounded border border-occ-accent bg-occ-accent-soft px-3 text-sm '
  + 'font-semibold text-occ-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent';

/**
 * The data block of a selection target (traffic/situationModel.js: selectionTarget).
 * - `target`: `{ kind, flight, aircraft }`; nothing to show without one.
 * - `telemetry`: the map's telemetry store (useMapSituation's `telemetry`, or the lab's): the age of the position and
 *   the countdown follow its clock. Without it the card shows what the target held when it was built.
 * - `station`: the station's own airport (the map flights' `stationAirport`), for «MIA → PUJ»; `stationId` stays in
 *   the links.
 * - `onClose()`: «Cerrar»; `style` places the card inside the map (the pages dock it at the top left).
 * - `onFollow()` and `following` (PR M6, follow mode): with `onFollow` the card's first action is «Seguir», a switch
 *   that keeps its name and is pressed while `following` (pressing it again stops); it waits, disabled, while the
 *   aircraft has no position on the map. Screens inside an OccMap pass its context's `follow` (`toggle`,
 *   `following`).
 * - «Seguir en 3D» (CN-30): inside an OccMap that can follow, the card also offers it (the map context's
 *   `follow.three`), pressed while the camera orbits the aircraft; pressing it again stops and flies the camera back.
 * - `variant` (CN-32): `overlay`, the card over the map or in a panel's flow (a dialog without aria-modal, with its
 *   heading and «Cerrar»), or `embedded`, the live part of a side panel that already names the flight, closes it and
 *   links to its turnaround and its stand (ui/MapSidePanel.jsx, Monitoreo de vuelos): a group without its own heading,
 *   «Cerrar» or links, that keeps its tags, its route and time, the telemetry, its stand and runway, its status, the
 *   source of its position and «Seguir».
 */
export default function FlightDataBlock({ target, telemetry: store = null, station = null, stationId = null, onClose,
  onFollow = null, following = false, variant = 'overlay', style, className = '' }) {
  const { t, language, locale } = useTranslation(mapMessages);
  const { t: tk } = useTranslation(kinematicsMessages);
  const aircraft = target?.aircraft ?? null;
  const flight = target?.flight ?? null;
  const fromStore = useTelemetry(store, aircraft?.id ?? null);
  const nowMs = useServerTime(store, STEP_MS);
  const three = useOccMap()?.follow?.three ?? null;
  if (!target) return null;

  // Until the store holds the aircraft, the values the target was built with.
  const telemetry = fromStore ?? (aircraft === null ? null
    : telemetryAt(aircraft, finite(aircraft.positionAt) ? aircraft.positionAt + (aircraft.ageS ?? 0) * 1_000 : null));
  const identifier = dataBlockIdentifier(target);
  const type = text(aircraft?.typeIcao) ?? text(flight?.aircraft?.typeIcaoCode);
  const registration = text(aircraft?.registration) ?? text(flight?.aircraft?.registration);
  const stationCode = text(station?.iataCode) ?? text(station?.icaoCode);
  const counterpart = text(flight?.counterpart?.iataCode) ?? text(flight?.counterpart?.icaoCode);
  const ends = flight?.direction === 'Departure' ? [stationCode, counterpart] : [counterpart, stationCode];
  const time = flightTimeLine(flight, nowMs, { t, locale });
  const source = sourceLine(telemetry, { t, language, tk });
  const links = dataBlockLinks(flight, { stationId });
  const notImported = flight !== null && flight.imported !== true;
  // What the motion says of it (PR M6): its plan's status, said once (a cancelled demo's time line already says it),
  // and whether the part it is in had to be scaled.
  const status = flight !== null ? statusLine(telemetry, tk) : null;
  const shownStatus = status !== null && status !== time?.words ? status : null;
  const scaled = flight?.isDemo === true ? timeScaleLine(telemetry, tk, language) : null;
  const embedded = variant === 'embedded';

  return (
    <div
      role={embedded ? 'group' : 'dialog'}
      aria-label={t('dataBlock.label', { id: identifier })}
      data-testid="flight-data-block"
      data-variant={variant}
      data-source={source.kind}
      style={embedded ? undefined : style}
      className={embedded
        ? `space-y-2 text-sm text-occ-text ${className}`.trim()
        : `absolute z-20 w-80 max-w-[calc(100%_-_1.5rem)] space-y-2 rounded-md border border-occ-line border-l-2 border-l-occ-accent bg-occ-panel-float p-3 text-sm text-occ-text ${className}`.trim()}
    >
      {!embedded && <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <h2 className="mr-1 font-mono text-base font-semibold leading-6 text-occ-text">{identifier}</h2>
          {type !== null && <OccPlate kind="code">{type}</OccPlate>}
          {registration !== null && <OccPlate kind="registration">{registration}</OccPlate>}
        </div>
        <button
          type="button"
          aria-label={t('dataBlock.close')}
          title={t('dataBlock.close')}
          onClick={onClose}
          className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-raised hover:text-occ-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4">
            <path d="M4 4 L12 12 M12 4 L4 12" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }} />
          </svg>
        </button>
      </div>}

      {(flight?.isDemo === true || notImported || flight === null) && (
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-occ-muted">
          {flight === null && <span>{t('dataBlock.other')}</span>}
          {flight?.isDemo === true && (
            <span data-occ-tag="demo" className="inline-flex items-center gap-1.5 text-occ-text">
              <OccStandSwatch tag="demo" />
              {t('dataBlock.demo')}
            </span>
          )}
          {notImported && (
            <span className="rounded-sm border border-occ-line-strong px-1.5 leading-5 text-occ-text">{t('dataBlock.notImported')}</span>
          )}
          {scaled !== null && <span data-time-scale="" className="text-occ-text">{scaled}</span>}
        </p>
      )}

      {flight !== null && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {(ends[0] !== null || ends[1] !== null) && (
            <span className="inline-flex items-center gap-1.5">
              <OccPlate kind="code">{ends[0] ?? '—'}</OccPlate>
              <span aria-hidden="true" className="text-occ-muted">→</span>
              <span className="sr-only">{t('dataBlock.to')}</span>
              <OccPlate kind="code">{ends[1] ?? '—'}</OccPlate>
            </span>
          )}
          {time !== null && (
            <span>
              {time.at === null ? time.words : <time dateTime={new Date(time.at).toISOString()}>{time.words}</time>}
              {time.relative !== null && <span className="text-occ-muted">{` · ${time.relative}`}</span>}
            </span>
          )}
        </p>
      )}

      {aircraft !== null && <Telemetry telemetry={telemetry} t={t} locale={locale} />}

      {flight !== null && <p className="border-t border-occ-line pt-2">{standWords(flight, t, telemetry)}</p>}

      {shownStatus !== null && <p data-status-line="" className="font-semibold text-occ-text">{shownStatus}</p>}

      {telemetry?.standMismatch && (
        <p data-stand-mismatch="" className="flex items-start gap-1.5 font-semibold text-occ-warn">
          <span aria-hidden="true">≠</span>
          <span>{t('dataBlock.standMismatch', telemetry.standMismatch)}</span>
        </p>
      )}

      <p data-source-line={source.kind} className="flex items-start gap-1.5 text-occ-muted">
        <span className="mt-0.5"><SourceMark kind={source.kind} /></span>
        <span>{source.words}</span>
      </p>

      {((flight !== null && !embedded) || onFollow !== null || three !== null) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {onFollow !== null && (
            <button
              type="button"
              aria-pressed={following === true}
              aria-keyshortcuts="S"
              disabled={following !== true && aircraft === null}
              onClick={onFollow}
              className={following === true ? ACTION_ON : (aircraft === null ? ACTION_OFF : ACTION)}
            >
              {t('follow.label')}
            </button>
          )}
          {three !== null && (three.on || onFollow !== null) && (
            <button
              type="button"
              aria-pressed={three.on}
              disabled={!three.on && aircraft === null}
              onClick={three.on ? three.stop : three.start}
              className={three.on ? ACTION_ON : (aircraft === null ? ACTION_OFF : ACTION)}
            >
              {t('follow.label3d')}
            </button>
          )}
          {flight !== null && !embedded && (links.turnaround !== null
            ? <Link href={links.turnaround} className={ACTION}>{t('dataBlock.viewTurnaround')}</Link>
            : <button type="button" disabled className={ACTION_OFF}>{t('dataBlock.viewTurnaround')}</button>)}
          {flight !== null && !embedded && links.stand !== null
            && <Link href={links.stand} className={ACTION}>{t('dataBlock.viewStand')}</Link>}
        </div>
      )}
    </div>
  );
}
