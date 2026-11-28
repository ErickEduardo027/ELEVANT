'use client';

import Link from 'next/link';
import { useTranslation } from '../../../i18n/LanguageScope';
import { writeSelection } from '../../maps/core/mapSelection';
import MapSidePanel, { MapSidePanelSection } from '../../maps/ui/MapSidePanel';
import DemoTag from '../../occ-ui/DemoTag';
import { occButtonClass } from '../../occ-ui/OccButton';
import { delayMinutesOf } from '../../occ-ui/occDelay';
import OccDelayChip from '../../occ-ui/OccDelayChip';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccMilestoneStrip from '../../occ-ui/OccMilestoneStrip';
import OccPlate from '../../occ-ui/OccPlate';
import { formatClock, toInstantMs } from '../../occ-ui/occTime';
import { SIGNALS } from '../../occ-ui/statusVocabulary';
import { legTimes } from '../flightBoardModel';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

// The inspector of Monitoreo de vuelos (design E.2; M1, «pantalla completa con paneles flotantes»): the chosen flight
// in the screen's side panel (maps/ui/MapSidePanel.jsx), floating over the full-screen map at its right, left of the
// control column (`floating`): the page measures it into the map's insets, so the camera keeps the flight clear of it.
// Where there is no map (another station), it sits in the page's grid (`framed`). It is a landmark (`aside`), not a
// dialog: no veil, no focus trap, and the map keeps its keys. One panel for the whole flight, top to bottom:
// - «En vivo», what the map knows of the aircraft: the map's data block, which the map renders in this panel's slot
//   (`liveSlotRef`, components/FlightMap.jsx: its route and time, altitude, speed and heading, stand and runway, the
//   source of its position and «Seguir»), so the flight has one card; the section shows only while it holds it;
// - «Horarios», its three times from the planning snapshot with its delay (occ-ui/occDelay.js);
// - its stand, agents, aircraft, registration and services; the milestone strip of its operation, from the map
//   flights FlightMap hands the page (onSelectionFlights);
// - in the footer, links to the same flight in Planificación and Mapa de posiciones through the one selection of the
//   URL (contratos 2.1).

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
    <time dateTime={new Date(toInstantMs(value)).toISOString()} className="font-mono tabular-nums">
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
 * station's; `onClose()` clears the selection («Cerrar detalle»). `milestones` (`{ status, phases }`,
 * dashboard/noc/milestoneModel.js: inspectorMilestones) draws the milestone strip of its operation. `liveSlotRef` (a
 * callback ref) receives the element the map renders the flight's live data block into. `variant` is MapSidePanel's
 * (`floating` over the map, `framed` in a grid) and `ref` goes on the panel, so the page measures it.
 */
export default function FlightInspector({
  ref, flight, strip, stationId = null, timeZone, onClose, milestones = null, liveSlotRef = null, variant = 'framed',
  className = '',
}) {
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
    <MapSidePanel
      ref={ref}
      label={t('inspector.label', { flight: strip.flightNumber })}
      data-occ-inspector="flight"
      variant={variant}
      className={className}
      title={(
        <>
          <OccPlate kind="flight" className="text-sm">{strip.flightNumber}</OccPlate>
          {strip.demo ? <DemoTag /> : null}
        </>
      )}
      // Where it comes from or goes, then its airline in secondary text: two words of one line, never joined by a dot.
      subtitle={(
        <>
          <span className="text-occ-text">
            {strip.counterpartIata
              ? t(arrival ? 'inspector.arrivalFrom' : 'inspector.departureTo', { code: strip.counterpartIata })
              : t(arrival ? 'inspector.arrival' : 'inspector.departure')}
          </span>
          {flight.airline ? <span className="text-occ-muted">{flight.airline}</span> : null}
        </>
      )}
      status={strip.status?.label ? (
        <>
          {signal ? <OccGlyph name={signal} /> : null}
          {signal ? <span className="sr-only">{`${SIGNALS[signal][language]}: `}</span> : null}
          <span>{strip.status.label}</span>
        </>
      ) : null}
      onClose={onClose}
      closeLabel={t('inspector.close')}
      footer={(
        <nav aria-label={t('inspector.links')} className="flex flex-wrap gap-2">
          <Link href={links.planning} className={LINK}>{t('inspector.viewPlanning')}</Link>
          <Link href={links.positions} className={LINK}>{t('inspector.viewPositions')}</Link>
        </nav>
      )}
    >
      {/* What the map knows of the aircraft, rendered here by the map (FlightMap): none while it does not know it. */}
      {liveSlotRef ? (
        <MapSidePanelSection title={t('inspector.live')} data-occ-live=""
          className="[&:has([data-occ-live-slot]:empty)]:hidden">
          <div ref={liveSlotRef} data-occ-live-slot="" />
        </MapSidePanelSection>
      ) : null}
      {/* The three times of the leg side by side, each with its kind in words, and its delay at the right of the title. */}
      <MapSidePanelSection title={t('inspector.times')} meta={<OccDelayChip minutes={delayMinutesOf(times)} />}>
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
      </MapSidePanelSection>
      <MapSidePanelSection title={t('inspector.visit')}>
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
        {/* The milestones of its operation, from the map flights (FlightMap): none while the map does not know it. */}
        {milestones ? (
          <OccMilestoneStrip phases={milestones.phases} status={milestones.status} locale={locale} timeZone={timeZone} />
        ) : null}
      </MapSidePanelSection>
    </MapSidePanel>
  );
}
