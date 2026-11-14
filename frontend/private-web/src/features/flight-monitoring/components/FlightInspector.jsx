'use client';

import Link from 'next/link';
import { useTranslation } from '../../../i18n/LanguageScope';
import { writeSelection } from '../../maps/core/mapSelection';
import DemoTag from '../../occ-ui/DemoTag';
import { occButtonClass } from '../../occ-ui/OccButton';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccPlate from '../../occ-ui/OccPlate';
import { formatClock, toInstantMs } from '../../occ-ui/occTime';
import { SIGNALS } from '../../occ-ui/statusVocabulary';
import { XIcon } from '../../shell/components/icons';
import { legTimes } from '../flightBoardModel';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

// The inspector of Monitoreo de vuelos (design E.2, template B): the detail of the chosen flight, docked at the side of
// the map and never over it, so it covers no aircraft and the map needs no inset. It is a landmark (`aside`), not a
// dialog: no veil, no focus trap, and the map keeps its keys. It shows what the page reads of the flight from the planning
// snapshot (its three times, its stand, its aircraft, its agents and services) and links to the same flight in
// Planificación and Mapa de posiciones through the one selection of the URL (contratos 2.1). What the map knows of the
// aircraft (its data block and the milestones of its operation) the map draws itself: the adapter does not hand its
// situation to the page (FlightMap.jsx).

const CLOSE = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-raised '
  + 'hover:text-occ-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
const LINK = occButtonClass({ variant: 'secondary', size: 'sm' });

/**
 * Where the inspector's links go, keeping `stationId` (contratos 2.1): Planificación with the flight (`flightId` = the
 * leg), and Mapa de posiciones with its stand (`stand`) or, without one, the flight. `{ planning, positions }`.
 */
export function inspectorLinks(flight, { stationId = null, standCode = null } = {}) {
  const base = () => new URLSearchParams(stationId ? { stationId } : {});
  const legId = String(flight?.id ?? '');
  const flightSelection = { selection: { kind: 'flight', id: legId } };
  const standSelection = standCode ? { selection: { kind: 'stand', id: standCode } } : flightSelection;
  return {
    planning: `/admin-occ/planning?${writeSelection(base(), flightSelection)}`,
    positions: `/admin-occ/positions-map?${writeSelection(base(), standSelection)}`,
  };
}

function Clock({ value, fallback, locale, timeZone }) {
  if (!Number.isFinite(toInstantMs(value))) return <span className="text-occ-muted">{fallback}</span>;
  return (
    <time dateTime={new Date(toInstantMs(value)).toISOString()} className="font-mono">
      {formatClock(value, locale, timeZone)}
    </time>
  );
}

// A fact read as its label over its value: the inspector is a narrow column, and two facts share a line.
function Fact({ label, wide = false, children }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-full' : ''}`}>
      <dt className="text-xs text-occ-muted">{label}</dt>
      <dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-occ-text">{children}</dd>
    </div>
  );
}

const Missing = ({ children }) => <span className="text-occ-muted">{children}</span>;

// «1 asignado», «2 asignados»: the agents a visit has (none says «Sin asignar»).
const agentsText = (count, t) => (count === 1 ? t('inspector.agentsOne') : t('inspector.agentsCount', { count }));

/**
 * The inspector. `flight` is the page's flight (a leg of the planning snapshot) and `strip` its strip on the board
 * (flightBoardModel.js: its direction, its stand and its status); `stationId` is kept in the links; `timeZone` is the
 * station's; `onClose()` clears the selection («Cerrar detalle»).
 */
export default function FlightInspector({ flight, strip, stationId = null, timeZone, onClose, className = '' }) {
  const { t, language, locale } = useTranslation(flightMonitoringMessages);
  if (!flight || !strip) return null;
  const arrival = strip.direction === 'Arrival';
  const times = legTimes(flight, strip.direction);
  const signal = strip.status?.signal ?? null;
  const links = inspectorLinks(flight, { stationId, standCode: strip.standCode });
  const services = Array.isArray(flight.services) ? flight.services.filter(Boolean) : [];
  const registration = typeof flight.registration === 'string' && flight.registration.trim() !== ''
    ? flight.registration : null;

  return (
    <aside aria-label={t('inspector.label', { flight: strip.flightNumber })} data-occ-inspector="flight"
      className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-occ-line bg-occ-panel text-occ-text ${className}`}>
      <header className="flex items-start gap-2 border-b border-occ-line py-2 pl-3 pr-2">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            <OccPlate kind="flight" className="text-sm">{strip.flightNumber}</OccPlate>
            {strip.demo ? <DemoTag /> : null}
          </h2>
          {/* Where it comes from or goes, then its airline in secondary text: two words of one line, never joined by a dot. */}
          <p className="flex flex-wrap gap-x-3 text-sm">
            <span className="text-occ-text">
              {strip.counterpartIata
                ? t(arrival ? 'inspector.arrivalFrom' : 'inspector.departureTo', { code: strip.counterpartIata })
                : t(arrival ? 'inspector.arrival' : 'inspector.departure')}
            </span>
            {flight.airline ? <span className="text-occ-muted">{flight.airline}</span> : null}
          </p>
          {strip.status?.label ? (
            <p className="flex items-center gap-1.5 text-sm text-occ-text">
              {signal ? <OccGlyph name={signal} /> : null}
              {signal ? <span className="sr-only">{`${SIGNALS[signal][language]}: `}</span> : null}
              <span>{strip.status.label}</span>
            </p>
          ) : null}
        </div>
        <button type="button" onClick={() => onClose?.()} aria-label={t('inspector.close')} title={t('inspector.close')}
          className={CLOSE}>
          <XIcon className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin]">
        {/* The three times of the leg side by side, each with its kind in words. */}
        <dl className="grid grid-cols-3 gap-x-3 rounded border border-occ-line px-2.5 py-2">
          <Fact label={t('inspector.scheduled')}>
            <Clock value={times.scheduledAt} fallback="—" locale={locale} timeZone={timeZone} />
          </Fact>
          <Fact label={t('inspector.estimated')}>
            <Clock value={times.estimatedAt} fallback={t('inspector.noEstimate')} locale={locale} timeZone={timeZone} />
          </Fact>
          <Fact label={t('inspector.actual')}>
            <Clock value={times.actualAt} fallback={t('inspector.pending')} locale={locale} timeZone={timeZone} />
          </Fact>
        </dl>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Fact label={t('inspector.stand')}>
            {strip.standCode
              ? <OccPlate kind="stand">{strip.standCode}</OccPlate>
              : <Missing>{t('inspector.noStand')}</Missing>}
          </Fact>
          <Fact label={t('inspector.agents')}>
            {Number.isInteger(flight.agents) && flight.agents > 0
              ? <span>{agentsText(flight.agents, t)}</span>
              : <Missing>{t('inspector.noAgents')}</Missing>}
          </Fact>
          <Fact label={t('inspector.aircraft')}>
            {flight.aircraft ? <span>{flight.aircraft}</span> : <Missing>{t('inspector.notRegistered')}</Missing>}
          </Fact>
          <Fact label={t('inspector.registration')}>
            {registration
              ? <OccPlate kind="registration">{registration}</OccPlate>
              : <Missing>{t('inspector.notRegistered')}</Missing>}
          </Fact>
          <Fact label={t('inspector.services')} wide>
            {services.length > 0 ? <span>{services.join(', ')}</span> : <Missing>{t('inspector.noServices')}</Missing>}
          </Fact>
        </dl>
        <nav aria-label={t('inspector.links')} className="flex flex-wrap gap-2 border-t border-occ-line pt-3">
          <Link href={links.planning} className={LINK}>{t('inspector.viewPlanning')}</Link>
          <Link href={links.positions} className={LINK}>{t('inspector.viewPositions')}</Link>
        </nav>
      </div>
    </aside>
  );
}
