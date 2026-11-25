'use client';

import { useTranslation } from '../../i18n/LanguageScope';
import { PlaneIcon } from '../shell/components/icons';
import DemoTag from './DemoTag';
import EstimatedTag from './EstimatedTag';
import { delayChipOf } from './occDelay';
import OccDelayChip from './OccDelayChip';
import OccGlyph from './OccGlyph';
import OccPlate from './OccPlate';
import { durationText, formatClock, relativeTimeParts, relativeTimeText, toInstantMs } from './occTime';
import { occUiMessages } from './occUiMessages';
import { SIGNALS, TAGS } from './statusVocabulary';

/** The cells of a strip, always in this order, like a flight progress strip (design F). Each cell has `data-part`. */
export const OCC_FLIGHT_STRIP_PARTS = Object.freeze([
  'direction', 'time', 'flight', 'tags', 'counterpart', 'stand', 'status', 'countdown',
]);

/**
 * How a strip is laid out, as pure classes so a test can read what jsdom does not apply. Two lines on fixed columns,
 * so strips stacked in a board line up field by field: the glyph spans both lines; the first holds the time, the
 * flight, its tags, the other airport and the stand; the second the status, under the time, and the countdown,
 * under the airport and the stand. The stand column fits «Sin posición».
 */
export const OCC_FLIGHT_STRIP_LAYOUT = Object.freeze({
  grid: 'grid grid-cols-[1rem_4.75rem_4.5rem_minmax(0,1fr)_2.75rem_5rem] items-center gap-x-1.5 gap-y-0.5 px-2 py-1',
  control: 'w-full rounded text-left hover:bg-occ-panel-raised',
  selected: 'outline outline-2 -outline-offset-2 outline-occ-accent',
});

const DIRECTIONS = Object.freeze({
  // The plane descends to the right on an arrival and climbs to the right on a departure.
  Arrival: Object.freeze({ word: 'flightStrip.arrival', counterpart: 'flightStrip.from', glyph: 'rotate-[135deg]' }),
  Departure: Object.freeze({ word: 'flightStrip.departure', counterpart: 'flightStrip.to', glyph: 'rotate-45' }),
});
const TIME_KINDS = Object.freeze(['actual', 'estimated', 'scheduled']);
const STATUS_SIGNALS = Object.freeze(['attention', 'urgent']);

// A typo in a board model never draws a silent strip.
function checkFlight(flight) {
  if (!Object.hasOwn(DIRECTIONS, flight?.direction)) {
    throw new RangeError(`Unknown OCC flight direction: ${String(flight?.direction)}`);
  }
  if (flight.time && !TIME_KINDS.includes(flight.time.kind)) {
    throw new RangeError(`Unknown OCC flight time kind: ${String(flight.time.kind)}`);
  }
  const signal = flight.status?.signal ?? null;
  if (signal !== null && !STATUS_SIGNALS.includes(signal)) throw new RangeError(`Unknown OCC flight signal: ${String(signal)}`);
}

const hasInstant = time => Number.isFinite(toInstantMs(time?.at));

// The delay of a strip in words (CN-32, occDelay.js), as its chip reads it: «Atención: 18 min de demora».
function delayWords(flight, { t, language }) {
  const chip = delayChipOf(flight.delayMinutes);
  if (chip === null) return '';
  const words = t('delay.name', { count: chip.minutes });
  return chip.signal ? `${SIGNALS[chip.signal][language]}: ${words}` : words;
}

// The countdown of a strip with a time: «en 12 min», «ahora» or «hace 3 min». An arrival's runway time (`actualKind:
// 'Runway'`, as the feed and the demo worker write it) says what it is, «aterrizó hace 3 min»: it only says that the
// aircraft landed, never that it reached its stand (N23).
function countdownText(flight, now, t) {
  const parts = relativeTimeParts(flight.time.at, now);
  if (parts?.tense === 'past' && flight.direction === 'Arrival' && flight.time.kind === 'actual'
    && flight.time.actualKind === 'Runway') {
    return t('flightStrip.landedAgo', { duration: durationText(parts, t) });
  }
  return relativeTimeText(flight.time.at, now, t);
}

/**
 * The strip read out in full words, in the order of its cells: «Llegada, 14:44 estimada, ZZ9001, Demo, desde MIA,
 * posición A7, En aproximación, en 12 min». `t` translates occUiMessages; `now` (milliseconds or an instant) adds the
 * countdown.
 */
export function flightStripName(flight, { t, language = 'es', locale, timeZone = 'UTC', now } = {}) {
  checkFlight(flight);
  const direction = DIRECTIONS[flight.direction];
  const status = flight.status ?? null;
  const signal = status?.signal ?? null;
  const parts = [
    t(direction.word),
    hasInstant(flight.time)
      ? `${formatClock(flight.time.at, locale, timeZone)} ${t(`flightStrip.timeKind.${flight.time.kind}`)}`
      : t('flightStrip.noTime'),
    flight.flightNumber,
    flight.demo ? TAGS.demo[language] : '',
    flight.estimated ? t('flightStrip.estimated') : '',
    flight.counterpartIata ? t(direction.counterpart, { code: flight.counterpartIata }) : '',
    flight.standCode ? t('flightStrip.stand', { code: flight.standCode }) : t('flightStrip.noStand'),
    status?.label ? (signal ? `${SIGNALS[signal][language]}: ${status.label}` : status.label) : '',
    delayWords(flight, { t, language }),
    hasInstant(flight.time) ? countdownText(flight, now, t) : '',
  ];
  return parts.filter(part => typeof part === 'string' && part.length > 0).join(', ');
}

function Cells({ flight, t, language, locale, timeZone, now }) {
  const direction = DIRECTIONS[flight.direction];
  const timed = hasInstant(flight.time);
  const signal = flight.status?.signal ?? null;
  const countdown = timed ? countdownText(flight, now, t) : '';
  const dateTime = timed ? new Date(toInstantMs(flight.time.at)).toISOString() : undefined;

  return (
    <>
      <span data-part="direction" className="row-span-2 flex items-center justify-center self-center text-occ-muted">
        <PlaneIcon className={`h-4 w-4 ${direction.glyph}`} />
        <span className="sr-only">{t(direction.word)}</span>
      </span>
      <span data-part="time" className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
        {timed ? (
          <>
            <time dateTime={dateTime} className="font-mono text-sm font-medium text-occ-text">
              {formatClock(flight.time.at, locale, timeZone)}
            </time>
            <span aria-hidden="true" className="text-xs text-occ-muted">{t(`flightStrip.timeKindShort.${flight.time.kind}`)}</span>
            <span className="sr-only">{t(`flightStrip.timeKind.${flight.time.kind}`)}</span>
          </>
        ) : <span className="text-xs text-occ-muted">{t('flightStrip.noTime')}</span>}
      </span>
      <span data-part="flight" className="flex min-w-0 items-center">
        <OccPlate kind="flight">{flight.flightNumber}</OccPlate>
      </span>
      <span data-part="tags" className="flex min-w-0 flex-wrap items-center gap-1">
        {flight.demo ? <DemoTag /> : null}
        {flight.estimated ? <EstimatedTag /> : null}
      </span>
      <span data-part="counterpart" className="flex min-w-0 items-center">
        {flight.counterpartIata ? (
          <>
            <span aria-hidden="true" className="flex"><OccPlate kind="code">{flight.counterpartIata}</OccPlate></span>
            <span className="sr-only">{t(direction.counterpart, { code: flight.counterpartIata })}</span>
          </>
        ) : null}
      </span>
      <span data-part="stand" className="flex min-w-0 items-center">
        {flight.standCode ? (
          <>
            <span aria-hidden="true" className="flex"><OccPlate kind="stand">{flight.standCode}</OccPlate></span>
            <span className="sr-only">{t('flightStrip.stand', { code: flight.standCode })}</span>
          </>
        ) : <span className="whitespace-nowrap text-xs text-occ-muted">{t('flightStrip.noStand')}</span>}
      </span>
      <span data-part="status" className="col-start-2 col-end-5 flex min-w-0 items-center gap-1.5 text-xs text-occ-text">
        {signal ? <OccGlyph name={signal} /> : null}
        {signal ? <span className="sr-only">{`${SIGNALS[signal][language]}: `}</span> : null}
        {flight.status?.label ? <span className="min-w-0 truncate">{flight.status.label}</span> : null}
        {/* The delay goes with what the flight is doing (CN-32): the strip's button says it in flightStripName. */}
        <OccDelayChip minutes={flight.delayMinutes} />
      </span>
      <span data-part="countdown" className="col-start-5 col-end-7 whitespace-nowrap text-right text-xs tabular-nums text-occ-muted">
        {countdown}
      </span>
    </>
  );
}

/**
 * One flight as a strip of the board (design F): its cells always in the order of OCC_FLIGHT_STRIP_PARTS, direction
 * glyph · time with its kind («real», «est.», «prog.») · flight plate · «Demo» and «est.» tags · the other airport ·
 * stand plate or «Sin posición» · status with its delay chip (CN-32) · countdown («en 12 min», «ahora», «hace 3 min», once `now` is given;
 * «aterrizó hace 3 min» for an arrival's runway time, N23).
 * `flight` is `{ id, direction: 'Arrival' | 'Departure', flightNumber, counterpartIata, time: { at, kind, actualKind? }
 * | null, standCode, status: { label, signal: null | 'attention' | 'urgent' } | null, demo, estimated, delayMinutes? }`
 * (`delayMinutes`, CN-32: the minutes its best time runs past its scheduled one, occDelay.js), `actualKind`
 * the kind of an actual time when it is known (`Runway` or `OnBlock`, dashboard/noc/boardModel.js: bestTime); the board
 * model builds it (the status words are its own).
 * - With `onSelect` it is a toggle button with `aria-pressed`, named in full words (flightStripName), that calls
 *   `onSelect(flight)`; `selected` draws the cyan casing. Without `onSelect` it is text, not a control.
 * - A status with a signal draws its glyph next to its words; a normal status carries no hue.
 * Times are «14:44» in `timeZone`, for `locale` (the language's by default). It forwards `data-testid`. An unknown
 * direction, time kind or signal throws.
 */
export default function OccFlightStrip({
  flight, selected = false, onSelect, now, locale, timeZone = 'UTC', className = '', 'data-testid': testId,
}) {
  const { t, language, locale: languageLocale } = useTranslation(occUiMessages);
  checkFlight(flight);
  const timeLocale = locale ?? languageLocale;
  const cells = <Cells flight={flight} t={t} language={language} locale={timeLocale} timeZone={timeZone} now={now} />;

  if (typeof onSelect !== 'function') {
    return (
      <div data-occ-flight-strip={flight.id} data-testid={testId} className={`${OCC_FLIGHT_STRIP_LAYOUT.grid} ${className}`}>
        {cells}
      </div>
    );
  }
  return (
    <button type="button" aria-pressed={selected} onClick={() => onSelect(flight)} data-occ-flight-strip={flight.id}
      data-testid={testId}
      aria-label={flightStripName(flight, { t, language, locale: timeLocale, timeZone, now })}
      className={`${OCC_FLIGHT_STRIP_LAYOUT.grid} ${OCC_FLIGHT_STRIP_LAYOUT.control} ${selected ? OCC_FLIGHT_STRIP_LAYOUT.selected : ''} ${className}`}>
      {cells}
    </button>
  );
}
