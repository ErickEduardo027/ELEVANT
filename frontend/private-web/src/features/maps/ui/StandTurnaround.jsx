'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { operationStatusLabel } from '../../operations/operationLabels';
import { buildMilestonePhases } from '../../occ-ui/milestonePhases';
import OccMilestoneStrip from '../../occ-ui/OccMilestoneStrip';
import { mapMessages } from '../mapMessages';
import { displayFromStatus, visitCoverageNames } from '../stands/standModel';
import { stationTime } from '../traffic/stationTime';

// The visits of a stand on the OCC maps (owner request of 2026-11-15), for its drawer on Mapa de posiciones and the
// console's inspector: the turnaround on it (or the one coming, on a stand still waiting) with its flight and airline,
// its aircraft, origin and destination, the scheduled, estimated and actual times of its arrival (when it landed apart
// from when it reached the stand, N23) and departure, the countdown of what comes next, its agent and the state of its
// operation, its milestones (occ-ui/OccMilestoneStrip.jsx, from the map flights' `milestones`), and the next
// turnaround onto the stand. From what the screen already read (useStandDisplay over the positions board and the map
// flights: stands/standModel.js, `display.detail` and `display.next`): no read is added. Times are the station's.

const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const KNOWN_STATUSES = new Set(Object.keys(mapMessages.es.turnaround.statuses));

/**
 * The times of one leg, what is known of them, or null: «Prog. 10:40 · Est. 10:52 · Real 10:55». An arrival tells its
 * landing from its stand (stands/standModel.js: visitDetail, N23): «Aterrizó 10:49 · En posición 10:55». «Real» is an
 * actual time that tells no kind: a departure's, or the board's arrival time alone.
 */
export function legTimes(times, t, locale) {
  const told = Number.isFinite(times?.landedAt) || Number.isFinite(times?.onStandAt);
  const parts = [['scheduled', 'scheduledAt'], ['estimated', 'estimatedAt'], ['landed', 'landedAt'],
    ['onStand', 'onStandAt'], ...(told ? [] : [['actual', 'actualAt']])]
    .map(([kind, field]) => {
      const time = stationTime(times?.[field] ?? null, locale);
      return time === null ? null : t(`turnaround.${kind}`, { time });
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The countdown of a stand's visit: its arrival while it is to come, else its departure, or how late it is to leave. */
export function countdownOf(display, t) {
  const arrival = display?.minutesToArrival;
  const departure = display?.minutesToDeparture;
  const arrived = display?.detail?.arrival?.actualAt != null || display?.state === 'occupied' || display?.state === 'releasing';
  if (!arrived && Number.isFinite(arrival) && arrival >= 0) return t('turnaround.arrivesIn', { minutes: arrival });
  if (Number.isFinite(departure) && departure >= 0) return t('turnaround.departsIn', { minutes: departure });
  if (Number.isFinite(departure) && departure < 0 && arrived) return t('turnaround.departedLate', { minutes: -departure });
  return null;
}

function Row({ label, value, fact }) {
  return (
    <div data-fact={fact} className="contents">
      <dt className="text-occ-muted">{label}</dt>
      <dd className="min-w-0 break-words font-semibold text-occ-text">{value}</dd>
    </div>
  );
}

/**
 * The visits of `position` (a stand of a positions screen, as useStandDisplay reads it). `milestones: false` leaves out
 * the milestone strip where the screen draws it already (the console's inspector). `locale` and `timeZone` as the
 * screen's.
 */
export default function StandTurnaround({ position, milestones = true, className = '' }) {
  const { t, language, locale } = useTranslation(mapMessages);
  if (!position) return null;
  const display = position.display ?? displayFromStatus(position);
  const visit = display.visit ?? null;
  const detail = display.detail ?? null;
  const next = display.next ?? null;
  if (visit === null && next === null) return null;
  const unknown = t('turnaround.unknown');

  const flights = visit ? [text(visit.arrivalFlightNumber), text(visit.departureFlightNumber)].filter(Boolean) : [];
  const flight = flights.length > 0 ? [...new Set(flights)].join(' / ') : text(display.flightNumber) ?? unknown;
  const aircraft = [text(display.aircraftType), text(detail?.registration) ?? text(visit?.aircraftRegistration)]
    .filter(Boolean).join(' · ') || unknown;
  const route = detail && (detail.origin || detail.destination)
    ? `${detail.origin ?? unknown} – ${detail.destination ?? unknown}` : unknown;
  // Who covers the visit (N26, D-N26): the aircraft on the stand now, the one to come when it reaches the stand.
  const agents = visitCoverageNames(position);
  const agent = agents.length > 0 ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(agents)
    : t('turnaround.unassigned');
  // «Operación» is the state of the ground operation (Asignada, En curso, Devuelta…: operations/operationLabels.js, the
  // words of Planificación) once the map flights bring it; without an operation, the turnaround's own state.
  const operationStatus = text(detail?.operationStatus);
  const turnaroundStatus = text(detail?.turnaroundStatus) ?? text(visit?.status);
  let statusWord = unknown;
  if (operationStatus !== null) statusWord = operationStatusLabel(operationStatus, language);
  else if (turnaroundStatus !== null) {
    statusWord = KNOWN_STATUSES.has(turnaroundStatus) ? t(`turnaround.statuses.${turnaroundStatus}`) : turnaroundStatus;
  }
  const countdown = countdownOf(display, t);
  const legs = Array.isArray(detail?.legs) ? detail.legs : [];
  const hasOperation = legs.some(leg => leg?.turnaround?.operationId);
  const phases = milestones && legs.length > 0 && hasOperation
    ? buildMilestonePhases(legs.flatMap(leg => (Array.isArray(leg?.milestones) ? leg.milestones : [])), language)
    : null;
  const nextTime = next ? stationTime(next.arrivalAt, locale) : null;
  let nextLine = null;
  if (next) {
    const nextFlight = text(next.flightNumber) ?? unknown;
    if (nextTime === null) nextLine = nextFlight;
    else if (Number.isFinite(next.minutesToArrival) && next.minutesToArrival >= 0) {
      nextLine = t('turnaround.nextLineIn', { flight: nextFlight, time: nextTime, minutes: next.minutesToArrival });
    } else nextLine = t('turnaround.nextLine', { flight: nextFlight, time: nextTime });
  }

  return (
    <section data-testid="stand-turnaround" aria-label={t('turnaround.current')}
      className={`space-y-2 rounded-md border border-occ-line bg-occ-panel px-3 py-2 text-sm text-occ-text ${className}`.trim()}>
      {visit && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-occ-muted">{t('turnaround.current')}</h3>
            {countdown && <span data-fact="countdown" className="font-mono text-xs font-semibold text-occ-text">{countdown}</span>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <Row fact="flight" label={t('turnaround.flight')} value={flight} />
            <Row fact="airline" label={t('turnaround.airline')} value={text(detail?.airline) ?? text(visit.airlineName) ?? unknown} />
            <Row fact="aircraft" label={t('turnaround.aircraft')} value={aircraft} />
            <Row fact="route" label={t('turnaround.route')} value={route} />
            <Row fact="arrival" label={t('turnaround.arrival')} value={legTimes(detail?.arrival, t, locale) ?? unknown} />
            <Row fact="departure" label={t('turnaround.departure')} value={legTimes(detail?.departure, t, locale) ?? unknown} />
            <Row fact="agent" label={t('turnaround.agent')} value={agent} />
            <Row fact="operation" label={t('turnaround.operation')} value={statusWord} />
          </dl>
          {phases && <OccMilestoneStrip phases={phases} locale={locale} />}
        </>
      )}
      {nextLine && (
        <p data-fact="next" className="border-t border-occ-line pt-2 text-xs">
          <span className="block font-semibold uppercase tracking-wide text-occ-muted">{t('turnaround.next')}</span>
          <span className="font-mono">{nextLine}</span>
        </p>
      )}
    </section>
  );
}
