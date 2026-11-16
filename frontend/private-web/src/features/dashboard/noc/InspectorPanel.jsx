'use client';

import { useId } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import AircraftRegistryFacts from '../../aviation-reference/AircraftRegistryFacts';
import { AirportDelaysLine } from '../../aviation-reference/AirportDelays';
import FlightDataBlock from '../../maps/ui/FlightDataBlock';
import StandDetailFacts from '../../maps/ui/StandDetailFacts';
import StandTurnaround from '../../maps/ui/StandTurnaround';
import OccFlightStrip from '../../occ-ui/OccFlightStrip';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import OccMilestoneStrip from '../../occ-ui/OccMilestoneStrip';
import OccPlate from '../../occ-ui/OccPlate';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_PRIMARY_ACTION, CONSOLE_SCROLL, CONSOLE_SECTION_TITLE } from './consoleStyles';
import { inspectorMilestones } from './milestoneModel';

// The «Inspector» of the console (contratos 2.5): the detail of the one selection, at the side of the map under
// «Alertas». A flight or an aircraft shows the maps lane's data block (maps/ui/FlightDataBlock.jsx) and the milestone
// strip of its operation, with «Importar» while the flight waits in the feed and «Asignar agente» while its imported
// operation has nobody; a stand shows what it says of itself on the map (maps/ui/StandDetailFacts.jsx) and its current
// or next flight with that flight's milestones. The container is the console's; the content is the map's.

// The data block is a card docked over a map; here it sits in the inspector's flow, across its width.
const DOCKED_IN_FLOW = '!static !w-full !max-w-none';

/**
 * The inspector panel. `selection` is the URL selection (`{ kind, id }`); `target` what the map knows of a flight or an
 * aircraft (useMapSituation's `target`), with its `telemetry`, `stationAirport` and `stationId`; `stand` the selected
 * stand as the map draws it (useStandDisplay) and `standFlight` its current or next map flight, with `stripOf(flight)`
 * the board's strip of a flight; `mapFlights` the map flights (both legs of a visit share its milestones);
 * `canImport(flight)` and `canAssign(flight)` say which actions the flight has, and `onImport(flight)`,
 * `onAssign(flight)` and `onClear()` run them. `aircraftFacts` (a node, or a function of the stand's aircraft) goes under
 * a stand's state for the aircraft parked on it or arriving (maps/ui/StandDetailFacts.jsx). `nowMs` is the server's time and `timeZone` the station's.
 */
export default function InspectorPanel({
  selection, target = null, telemetry = null, stationAirport = null, stationId = null, stand = null, standFlight = null,
  stripOf, mapFlights, canImport, canAssign, onImport, onAssign, onClear, nowMs, timeZone, measureRef,
  layout = 'float', className = '', aircraftFacts = null,
}) {
  const { t, language, locale } = useTranslation(consoleMessages);
  const standFlightTitleId = useId();
  const flight = selection?.kind === 'stand' ? standFlight : target?.flight ?? null;
  const milestones = flight ? inspectorMilestones(flight, mapFlights, language) : null;
  const actions = flight ? (
    <div className="flex flex-wrap gap-2">
      {canImport?.(flight)
        ? <button type="button" onClick={() => onImport?.(flight)} className={CONSOLE_PRIMARY_ACTION}>{t('inspector.import')}</button>
        : null}
      {canAssign?.(flight)
        ? <button type="button" onClick={() => onAssign?.(flight)} className={CONSOLE_PRIMARY_ACTION}>{t('inspector.assign')}</button>
        : null}
    </div>
  ) : null;
  const clear = <button type="button" onClick={onClear} className={CONSOLE_ACTION}>{t('inspector.clear')}</button>;

  // AeroDataBox (ADR-0028, note of 15 November 2026): what it knows of the aircraft by its registration and the delays
  // of the flight's other airport, read when the flight or the stand is chosen; never for a demo flight.
  const standAircraftFacts = aircraft => (aircraft?.isDemo || !aircraft?.registration ? null
    : <AircraftRegistryFacts stationId={stationId} registration={aircraft.registration} />);
  const flightRegistration = target?.aircraft?.registration ?? target?.flight?.aircraft?.registration ?? null;
  const counterpart = target?.flight?.counterpart?.iataCode ?? target?.flight?.counterpart?.icaoCode ?? null;

  let body;
  if (selection?.kind === 'stand' && stand) {
    const strip = standFlight ? stripOf?.(standFlight) ?? null : null;
    body = (
      <>
        <div className="flex items-center justify-between gap-2">
          <OccPlate kind="stand" className="text-sm">{stand.id ?? stand.code}</OccPlate>
          {clear}
        </div>
        <StandDetailFacts position={stand} aircraftFacts={aircraftFacts ?? standAircraftFacts} />
        {/* The inspector draws the milestones of the stand's flight below, once. */}
        <StandTurnaround position={stand} milestones={false} />
        <section aria-labelledby={standFlightTitleId} className="space-y-2">
          <h3 id={standFlightTitleId} className={`${CONSOLE_SECTION_TITLE} px-0 pt-0`}>{t('inspector.standFlight')}</h3>
          {strip ? <OccFlightStrip flight={strip} now={nowMs} timeZone={timeZone} locale={locale} /> : null}
          {!standFlight ? <p className="text-sm text-occ-muted">{t('inspector.noVisit')}</p> : null}
        </section>
      </>
    );
  } else if (selection?.kind !== 'stand' && target) {
    body = (
      <>
        <FlightDataBlock target={target} telemetry={telemetry} station={stationAirport} stationId={stationId}
          onClose={onClear} className={DOCKED_IN_FLOW} />
        <AircraftRegistryFacts stationId={stationId} registration={flightRegistration}
          isDemo={target.flight?.isDemo === true} />
        {target.flight && target.flight.isDemo !== true ? (
          <AirportDelaysLine stationId={stationId} airport={counterpart}
            role={target.flight.direction === 'Departure' ? 'destination' : 'origin'} />
        ) : null}
      </>
    );
  } else {
    body = (
      <div className="space-y-2">
        <p className="text-sm text-occ-text">{t('inspector.unknown')}</p>
        {clear}
      </div>
    );
  }

  return (
    <OccFloatingPanel ref={measureRef} panelId="inspector" title={t('panels.inspector')} layout={layout}
      className={className} bodyClassName="h-full min-h-0">
      <div data-occ-inspector={selection?.kind ?? 'none'} className={`h-full min-h-0 space-y-3 p-2 ${CONSOLE_SCROLL}`}>
        {body}
        {milestones ? (
          <OccMilestoneStrip phases={milestones.phases} status={milestones.status} locale={locale} timeZone={timeZone} />
        ) : null}
        {actions}
      </div>
    </OccFloatingPanel>
  );
}
