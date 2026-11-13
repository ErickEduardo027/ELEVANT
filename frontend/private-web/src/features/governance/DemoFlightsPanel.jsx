import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Badge from '../../components/Badge';
import ConfirmDialog from '../../components/ConfirmDialog';
import StatusBadge from '../../components/StatusBadge';
import { BUSINESS_TIME_ZONE } from '../../services/businessDay';
import { createCommandKeyHolder } from '../../services/commandKeys';
import {
  cancelDemoFlight, createDemoFlight, demoFlightMessage, demoStationMessage, listDemoFlights, loadDemoFlightOptions,
  prepareDemoStation,
} from '../../services/demoFlightsService';
import { isConflict } from '../../services/problemMessages';
import {
  clockTime, countdownText, demoFlightAction, demoFlightPhase, isMoving, operationStatusLabel, phaseLabel, serverClockOffset,
} from './demoFlightStatus';
import { reasonsSentence, standReasonText } from './demoStandReasons';

const card = 'rounded-xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card';
const inset = 'rounded-lg border border-black/10 p-4 dark:border-white/10';
const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-white/10 dark:bg-surface-dark';
const muted = 'text-text-secondary-light dark:text-text-secondary-dark';
const alertClass = 'rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger';
const successClass = 'rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm';
const warningClass = 'rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm';
const secondaryButton = 'rounded-lg border border-accent-600 px-3 py-1.5 text-xs font-semibold text-accent-600 disabled:opacity-50';
const dangerButton = 'rounded-lg border border-status-danger px-3 py-1.5 text-xs font-semibold text-status-danger disabled:opacity-50';

/**
 * Clock times of the panel are AVIAM's calendar (America/Santo_Domingo), the zone of its stations: the demo flight
 * contracts do not carry the station's zone.
 */
const CLOCK_ZONE = BUSINESS_TIME_ZONE;
const QUICK_MINUTES = [3, 5, 8, 15];
const PREFERRED_ORIGIN = 'MIA';
/** Stands in natural order: A1, A2, A10, AN1, B20. */
const STAND_ORDER = new Intl.Collator('es', { numeric: true });
const NAMES = new Intl.ListFormat('es', { type: 'conjunction' });
const NO_FLIGHTS = [];
const WHOLE_NUMBER = /^\s*\d+\s*$/;
/** «Al azar» and «Sin posición» of the field «Posición»; any other value is the id of a stand. */
const RANDOM_STAND = 'random';
const NO_STAND = 'none';
/** The fields of the form that change which stands are eligible: the aircraft's size and the window of the visit. */
const WINDOW_FIELDS = new Set(['aircraftTypeId', 'minutes', 'groundMinutes']);
/** «Crear cobertura»: OCC's «Cobertura de posiciones» (`app/admin-occ/position-coverage`), in another tab. */
const COVERAGE_PATH = '/admin-occ/position-coverage';
/**
 * The options change with the time: the warnings (crosses_local_midnight comes once the longest arrival would park after
 * midnight), today's airlines and the free stands. Once they are this old, the next read of the list reads them again.
 */
const OPTIONS_MAX_AGE_MS = 5 * 60_000;

/** The warnings this panel explains (ADR-0041); they never block the trigger. Codes it does not know are not shown. */
const WARNING_TEXT = Object.freeze({
  no_occ_accounts: 'Ninguna cuenta de OCC tiene esta estación en su alcance: nadie verá el vuelo.',
  crosses_local_midnight: 'Falta poco para la medianoche en la estación: si el avión llega después, el vuelo queda en la planificación de mañana.',
});

/** The session expired (401) or the account is not the superadministrator (403): nothing to retry. */
const denied = error => error?.status === 401 || error?.status === 403;

const wholeNumber = text => (WHOLE_NUMBER.test(text) ? Number(text) : Number.NaN);
const capitalized = text => text.charAt(0).toLocaleUpperCase('es') + text.slice(1);
const sameId = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  left.toLowerCase() === right.toLowerCase();

/**
 * The window the stands are evaluated for (the `window` of `loadDemoFlightOptions`), from the form's values: the aircraft
 * type, whose size the stand must admit, and the minutes to the stand and on the ground. Null while a value is outside
 * the form's ranges: the server would refuse it.
 */
function windowOf({ aircraftTypeId, minutes, groundMinutes }, limits) {
  const within = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const minutesToOnBlock = wholeNumber(minutes);
  const ground = wholeNumber(groundMinutes);
  if (!aircraftTypeId || !within(minutesToOnBlock, limits.minMinutesToOnBlock, limits.maxMinutesToOnBlock) ||
      !within(ground, limits.minGroundMinutes, limits.maxGroundMinutes)) return null;
  return { aircraftTypeId, minutesToOnBlock, groundMinutes: ground };
}

/** Who covers an eligible stand when the aircraft parks, by name, and how many of them OCC may assign when not all. */
function coverText({ coveredBy, eligibleAgents }) {
  const names = coveredBy.length > 2 ? [...coveredBy.slice(0, 2), `${coveredBy.length - 2} más`] : coveredBy;
  const cover = `${coveredBy.length === 1 ? 'Cubre' : 'Cubren'} ${NAMES.format(names)}`;
  return eligibleAgents < coveredBy.length
    ? `${cover} (${eligibleAgents} ${eligibleAgents === 1 ? 'elegible' : 'elegibles'})`
    : cover;
}

/**
 * A stand as the field «Posición» offers it: who covers it when it is eligible, otherwise why not in words; first the
 * flags (not located, not free), then the reasons of the rule.
 */
function standLabel(stand) {
  const where = `${stand.code} · Terminal ${stand.terminalCode}`;
  if (stand.eligible) return `${where} · ${coverText(stand)}`;
  const why = reasonsSentence([...(stand.located ? [] : ['stand_not_located']), ...(stand.free ? [] : ['stand_not_free']),
    ...stand.reasons]);
  return `${where} · ${why ? capitalized(why) : standReasonText(null)}`;
}

/** The warning `no_eligible_stand`, with the reasons the most stands give (at most three, ADR-0041). */
function noEligibleStandText(reasons) {
  const why = reasonsSentence(reasons);
  return `Ninguna posición habilitada tiene un agente elegible a esa hora${why ? `: ${why}` : ''}.`;
}

/** What the panel shows, from its two reads. The list only matters where demo flights run. */
function panelStatus(options, list) {
  if (denied(options.error) || denied(list.error)) return 'forbidden';
  if (options.status === 'error') return 'error';
  if (options.status === 'loading') return 'loading';
  if (!options.data.enabled) return 'disabled';
  if (list.status === 'error') return 'error';
  if (list.status === 'loading') return 'loading';
  return options.data.stationId ? 'ready' : 'noStation';
}

const numbersOf = flight => `${flight.arrivalFlightNumber} / ${flight.departureFlightNumber}`;

function createdNotice(flight, warnings) {
  const seen = warnings.some(warning => warning.code === 'no_occ_accounts') ? '' : ' OCC ya lo ve en los vuelos propuestos.';
  return `Vuelo demo ${numbersOf(flight)} creado. Llega a la posición a las ${clockTime(flight.onBlockAt, CLOCK_ZONE)}.${seen}`;
}

function endedNotice(flight, intent) {
  if (intent === 'Cancel') return flight.imported
    ? `Vuelo demo ${numbersOf(flight)} cancelado. OCC recibe el aviso de vuelo cancelado por el proveedor.`
    : `Vuelo demo ${numbersOf(flight)} cancelado. Salió de los vuelos propuestos de OCC.`;
  return flight.imported
    ? `Demo ${numbersOf(flight)} terminada: el avión sale de la posición.`
    : `Demo ${numbersOf(flight)} terminada.`;
}

/** The confirmation of «Cancelar vuelo» or «Terminar demo» (ADR-0041): what happens to OCC's side of the flight. */
function confirmation({ flight, intent, phase }) {
  if (intent === 'Cancel') return {
    title: 'Cancelar vuelo demo', confirmLabel: 'Cancelar vuelo', busyLabel: 'Cancelando…',
    description: flight.imported
      ? 'OCC ya importó este vuelo. Recibirá el aviso de vuelo cancelado por el proveedor y decidirá qué hacer con la escala.'
      : `El vuelo ${flight.arrivalFlightNumber} saldrá de los vuelos propuestos de OCC.`,
  };
  // The off-block comes forward whether OCC imported the flight or not, never before the aircraft reaches its stand.
  const leaves = phase === 'TaxiIn'
    ? 'El avión saldrá de la posición en cuanto llegue a ella.'
    : 'El avión saldrá ahora de la posición.';
  return {
    title: 'Terminar demo', confirmLabel: 'Terminar demo', busyLabel: 'Terminando…',
    description: flight.imported
      ? `${leaves} La operación de OCC sigue su curso.`
      : `${leaves} El vuelo ${flight.arrivalFlightNumber} dejará los vuelos propuestos de OCC.`,
  };
}

/**
 * «Disparar vuelo demo» (ADR-0041). Untouched fields take the defaults: the first airline, Miami, the first narrow-body
 * aircraft type, «Al azar» (the server draws one of the eligible stands; «Sin posición» when none is) and the server's
 * minutes. A value the station no longer offers falls back the same way, so a re-read never sends what disappeared. A
 * change of the aircraft type or of the minutes tells the panel the window to evaluate the stands for (`onWindow`, null
 * while a value is out of range); the draft survives the re-read, since the panel keys the form by station only.
 */
function DemoFlightForm({ data, standsLoadable, limitReached, maxActive, busy, error, notice, onStation, onSubmit,
  onWindow }) {
  const id = useId();
  const [draft, setDraft] = useState({ airlineId: '', originIata: '', destinationIata: '', aircraftTypeId: '', stand: '',
    minutes: null, groundMinutes: null });
  const { airlines, airports, aircraftTypes, limits, warnings } = data;
  const stands = [...data.stands].sort((left, right) => STAND_ORDER.compare(left.code, right.code));
  const canDraw = stands.some(stand => stand.eligible);

  const airlineId = airlines.some(airline => airline.id === draft.airlineId) ? draft.airlineId : airlines[0]?.id ?? '';
  const originIata = airports.some(airport => airport.iataCode === draft.originIata) ? draft.originIata
    : (airports.find(airport => airport.iataCode === PREFERRED_ORIGIN) ?? airports[0])?.iataCode ?? '';
  const destinationIata = airports.some(airport => airport.iataCode === draft.destinationIata) ? draft.destinationIata : '';
  const aircraftTypeId = aircraftTypes.some(type => type.id === draft.aircraftTypeId) ? draft.aircraftTypeId
    : (aircraftTypes.find(type => type.sizeCategory === 'Narrowbody') ?? aircraftTypes[0])?.id ?? '';
  // «Sin posición» is always there; a stand only while it is eligible; otherwise «Al azar» while there is one to draw.
  const stand = draft.stand === NO_STAND ? NO_STAND
    : stands.some(item => item.eligible && item.standId === draft.stand) ? draft.stand
      : canDraw ? RANDOM_STAND : NO_STAND;
  const minutes = draft.minutes ?? String(limits.defaultMinutesToOnBlock);
  const groundMinutes = draft.groundMinutes ?? String(limits.defaultGroundMinutes);

  const set = (key, value) => {
    setDraft(current => ({ ...current, [key]: value }));
    if (WINDOW_FIELDS.has(key)) onWindow(windowOf({ aircraftTypeId, minutes, groundMinutes, [key]: value }, limits));
  };

  const blockers = [
    !airlines.length && 'Ninguna aerolínea tiene contrato vigente hoy en esta estación. Active un contrato para disparar un vuelo demo.',
    !aircraftTypes.length && 'No hay tipos de avión activos. OCC los crea en «Datos maestros».',
    !airports.length && 'No hay aeropuertos de origen para esta estación.',
    limitReached && `Ya hay ${maxActive} vuelos demo activos en esta estación. Espere a que termine uno o cancélelo.`,
  ].filter(Boolean);

  /** Sends the form with a stand choice: the field's, or «Sin posición» from the warning without an eligible stand. */
  function send(choice) {
    if (blockers.length > 0 || busy) return;
    const standChoice = choice === RANDOM_STAND ? 'Random' : choice === NO_STAND ? 'None' : 'Specific';
    // Whole minutes only: anything else is refused before it is sent, with the ranges of the form.
    onSubmit({ stationId: data.stationId, airlineId, originIata, destinationIata: destinationIata || null, aircraftTypeId,
      standChoice, standId: standChoice === 'Specific' ? choice : null, minutesToOnBlock: wholeNumber(minutes),
      groundMinutes: wholeNumber(groundMinutes) });
  }

  function submit(event) {
    event.preventDefault();
    send(stand);
  }

  /** The warnings this form explains, in the server's order; they never block the trigger. */
  function warningOf(warning, index) {
    const key = `${warning.code}-${index}`;
    if (Object.hasOwn(WARNING_TEXT, warning.code)) return <p key={key} className={warningClass}>{WARNING_TEXT[warning.code]}</p>;
    if (warning.code === 'no_located_stands') return <p key={key} className={warningClass}>{standsLoadable
      ? 'Aún no hay posiciones ubicadas en el mapa. Use «Cargar posiciones» para que el avión tenga dónde estacionarse.'
      : 'Aún no hay posiciones ubicadas en el mapa: el avión no tendrá dónde estacionarse.'}</p>;
    if (warning.code !== 'no_eligible_stand') return null;
    // Nothing to draw: the flight goes without a stand (OCC assigns one when it imports it), or OCC covers one first.
    return (
      <div key={key} className={warningClass}>
        <p>{noEligibleStandText(warning.reasons)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="button" disabled={busy || blockers.length > 0} onClick={() => send(NO_STAND)}
            className={secondaryButton}>Disparar sin posición</button>
          <a href={COVERAGE_PATH} target="_blank" rel="noopener noreferrer" aria-describedby={`${id}-coverage`}
            className="text-xs font-semibold text-accent-600 underline underline-offset-2">Crear cobertura</a>
          <span id={`${id}-coverage`} className={`text-xs ${muted}`}>Se abre en el OCC, en otra pestaña.</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Disparar vuelo demo" className={`${inset} space-y-3`}>
      <h3 className="text-base font-bold">Disparar vuelo demo</h3>
      {warnings.map(warningOf)}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">Estación
          <select className={fieldClass} value={data.stationId} disabled={busy}
            onChange={event => onStation(event.target.value)}>
            {data.stations.map(station => <option key={station.id} value={station.id}>{station.code} · {station.name}</option>)}
          </select></label>
        <div>
          <label className="block text-xs font-semibold">Aerolínea
            <select className={fieldClass} value={airlineId} disabled={busy || !airlines.length}
              aria-describedby={`${id}-airline`} onChange={event => set('airlineId', event.target.value)}>
              {airlines.map(airline => <option key={airline.id} value={airline.id}>{airline.name}</option>)}
            </select></label>
          <p id={`${id}-airline`} className={`mt-1 text-xs ${muted}`}>
            Solo aerolíneas con contrato vigente hoy en la estación. El vuelo se opera y se factura como cualquier otro: use
            una aerolínea de prueba.</p>
        </div>
        <label className="block text-xs font-semibold">Origen
          <select className={fieldClass} value={originIata} disabled={busy || !airports.length}
            onChange={event => set('originIata', event.target.value)}>
            {airports.map(airport => <option key={airport.iataCode} value={airport.iataCode}>{airport.iataCode} · {airport.city}</option>)}
          </select></label>
        <label className="block text-xs font-semibold">Destino de la salida
          <select className={fieldClass} value={destinationIata} disabled={busy}
            onChange={event => set('destinationIata', event.target.value)}>
            <option value="">El mismo aeropuerto</option>
            {airports.map(airport => <option key={airport.iataCode} value={airport.iataCode}>{airport.iataCode} · {airport.city}</option>)}
          </select></label>
        <label className="block text-xs font-semibold">Tipo de avión
          <select className={fieldClass} value={aircraftTypeId} disabled={busy || !aircraftTypes.length}
            onChange={event => set('aircraftTypeId', event.target.value)}>
            {aircraftTypes.map(type => <option key={type.id} value={type.id}>{type.icaoCode} · {type.manufacturer} {type.model}</option>)}
          </select></label>
        <div>
          <label className="block text-xs font-semibold">Posición
            <select className={fieldClass} value={stand} disabled={busy} aria-describedby={`${id}-stand`}
              onChange={event => set('stand', event.target.value)}>
              <option value={RANDOM_STAND} disabled={!canDraw}>Al azar</option>
              <option value={NO_STAND}>Sin posición</option>
              {stands.map(item => <option key={item.standId} value={item.standId} disabled={!item.eligible}>
                {standLabel(item)}</option>)}
            </select></label>
          <p id={`${id}-stand`} className={`mt-1 text-xs ${muted}`}>
            Al azar: el servidor elige entre las posiciones con un agente elegible a esa hora. OCC puede asignar otra al
            importar.</p>
        </div>
        <div>
          <label htmlFor={`${id}-minutes`} className="block text-xs font-semibold">Llega a la posición en (minutos)</label>
          <input id={`${id}-minutes`} type="number" inputMode="numeric" className={fieldClass} value={minutes} disabled={busy}
            min={limits.minMinutesToOnBlock} max={limits.maxMinutesToOnBlock} step={1} aria-describedby={`${id}-minutes-hint`}
            onChange={event => set('minutes', event.target.value)} />
          <div role="group" aria-label="Atajos de minutos hasta la posición" className="mt-2 flex flex-wrap gap-2">
            {QUICK_MINUTES.map(value => <button key={value} type="button" disabled={busy} aria-pressed={minutes.trim() === String(value)}
              onClick={() => set('minutes', String(value))}
              className={`min-h-9 rounded-lg border px-3 text-xs font-semibold ${minutes.trim() === String(value)
                ? 'border-accent-600 bg-accent-600 text-white' : 'border-black/10 dark:border-white/10'}`}>{value} min</button>)}
          </div>
          <p id={`${id}-minutes-hint`} className={`mt-1 text-xs ${muted}`}>
            De {limits.minMinutesToOnBlock} a {limits.maxMinutesToOnBlock}. El avión aparece ya en aproximación, aterriza, rueda
            y se estaciona.</p>
        </div>
        <div>
          <label htmlFor={`${id}-ground`} className="block text-xs font-semibold">Tiempo en tierra (minutos)</label>
          <input id={`${id}-ground`} type="number" inputMode="numeric" className={fieldClass} value={groundMinutes} disabled={busy}
            min={limits.minGroundMinutes} max={limits.maxGroundMinutes} step={1} aria-describedby={`${id}-ground-hint`}
            onChange={event => set('groundMinutes', event.target.value)} />
          <p id={`${id}-ground-hint`} className={`mt-1 text-xs ${muted}`}>
            De {limits.minGroundMinutes} a {limits.maxGroundMinutes}. La salida se programa después de ese tiempo; si OCC
            importó el vuelo, el avión espera el push-back del agente.</p>
        </div>
      </div>
      {blockers.length > 0 && <div id={`${id}-blocked`} className="space-y-2">
        {blockers.map(text => <p key={text} className={warningClass}>{text}</p>)}</div>}
      {error && <p role="alert" className={alertClass}>{error}</p>}
      {notice && <p role="status" className={successClass}>{notice}</p>}
      <button type="submit" disabled={busy || blockers.length > 0}
        aria-describedby={blockers.length > 0 ? `${id}-blocked` : undefined}
        className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Disparando…' : 'Disparar vuelo demo'}</button>
    </form>
  );
}

/** Two answers about the same station state: the same terminals and the same stands, present and missing. */
const sameStands = (left, right) => left.terminals === right.terminals && left.stands === right.stands &&
  left.missingStands.join(',') === right.missingStands.join(',');

/**
 * What a load could not create: the catalogue's stands that are still missing once «Cargar posiciones» answered this
 * same state, because their terminal or the stand itself is inactive (the command never reactivates a row).
 */
function stillMissingText({ missingStands }) {
  return missingStands.length > 0
    ? `Faltan: ${missingStands.join(', ')}. Su terminal o la posición están desactivadas: OCC puede activarlas en «Datos maestros».`
    : 'Una terminal del plano está desactivada: OCC puede activarla en «Datos maestros».';
}

/**
 * «Posiciones de Punta Cana» (ADR-0041, contracts 1.2): the station against the Punta Cana catalogue, from the options'
 * `layout`. «Cargar posiciones» creates the terminals and stands the station lacks, with the intent's Idempotency-Key;
 * once it is all there the card says so and offers no button. A load that leaves stands missing names them, and the
 * button comes back only when the station changes (OCC activated a terminal or a stand). `onLoaded(answer)` and
 * `onStale()` read the options again; a 409 or a 404 waits for that read before its message shows. The panel keys the
 * card by station: an answer that arrives once another station is on screen reads nothing.
 */
function PuntaCanaStandsCard({ layout, onLoaded, onStale }) {
  const headingId = useId();
  const keys = useRef(createCommandKeyHolder());
  const shown = useRef(false);
  const [load, setLoad] = useState({ busy: false, error: '', notice: '', answer: null });
  const stuck = load.answer !== null && !layout.complete && sameStands(load.answer, layout);
  const counts = `Terminales: ${layout.terminals} de ${layout.catalogTerminals} · Posiciones: ${layout.stands} de ` +
    `${layout.catalogStands} · Ubicadas en el mapa: ${layout.locatedStands} de ${layout.activeStands}`;

  useEffect(() => {
    shown.current = true;
    return () => { shown.current = false; };
  }, []);

  async function loadStands() {
    const { stationId } = layout;
    setLoad(current => ({ ...current, busy: true, error: '', notice: '' }));
    try {
      const answer = await keys.current.run('demo-station.prepare', { stationId }, key => prepareDemoStation(stationId, key));
      if (!shown.current) return;
      await onLoaded(answer);
      setLoad({ busy: false, error: '', notice: 'Se cargaron las posiciones de Punta Cana.', answer });
    } catch (failure) {
      if (!shown.current) return;
      // The station changed (409) or is gone (404): the options are read before the message shows.
      if (isConflict(failure) || failure?.status === 404) await onStale();
      setLoad(current => ({ ...current, busy: false, error: demoStationMessage(failure), notice: '' }));
    }
  }

  return (
    <section aria-labelledby={headingId} className={`${inset} space-y-3`}>
      <h3 id={headingId} className="text-base font-bold">Posiciones de Punta Cana</h3>
      {!layout.supported && <p className={`text-sm ${muted}`}>Solo Punta Cana (PUJ) tiene un plano de referencia.</p>}
      {layout.supported && <>
        <p className="text-sm tabular-nums">{counts}</p>
        {layout.complete && <p className={successClass}>
          Las terminales y las {layout.catalogStands} posiciones de Punta Cana ya están cargadas.</p>}
        {stuck && <p className={warningClass}>{stillMissingText(layout)}</p>}
        {!layout.complete && !stuck && <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`max-w-prose text-xs ${muted}`}>
            Crea las terminales y las posiciones de Punta Cana que falten. No cambia ni borra lo que OCC ya configuró.</p>
          <button type="button" disabled={load.busy} onClick={() => void loadStands()} className={secondaryButton}>
            {load.busy ? 'Cargando posiciones…' : 'Cargar posiciones'}</button>
        </div>}
        {layout.unmatchedStands.length > 0 && <p className={`text-xs ${muted}`}>
          Posiciones fuera del plano de referencia: {layout.unmatchedStands.join(', ')}. OCC puede desactivarlas en
          «Datos maestros».</p>}
      </>}
      {load.error && <p role="alert" className={alertClass}>{load.error}</p>}
      {load.notice && <p role="status" className={successClass}>{load.notice}</p>}
    </section>
  );
}

const STATE_TONE = Object.freeze({ Approach: 'info', TaxiIn: 'info', Parked: 'active', TaxiOut: 'info' });

/** One flight of «Vuelos demo de hoy», where its aircraft is at the server's time `serverNow`. */
function DemoFlightRow({ flight, serverNow, busy, onAction }) {
  const phase = demoFlightPhase(flight, serverNow);
  const action = demoFlightAction(flight, serverNow);
  const route = [flight.originIata || '—', flight.stationCode, flight.destinationIata || '—'].join(' → ');
  const tone = flight.state === 'Active' ? STATE_TONE[phase] ?? 'neutral' : 'neutral';
  const occ = flight.imported
    ? `Importado por OCC · ${flight.operationCode} · ${flight.standCode ? `Posición ${flight.standCode}` : 'Sin posición asignada'}`
    : `OCC aún no lo importa${flight.suggestedStandCode ? ` · Posición sugerida ${flight.suggestedStandCode}` : ''}`;
  const operation = operationStatusLabel(flight.operationStatus);
  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span><strong className="font-mono">{numbersOf(flight)}</strong> · {flight.airlineName} · {route}
            {flight.aircraftRegistration ? ` · ${flight.aircraftRegistration}` : ''}</span>
          <Badge label="Demo" />
        </p>
        <StatusBadge tone={tone} label={phaseLabel(flight.state, phase)} />
      </div>
      <p className="text-sm tabular-nums">{countdownText(flight, serverNow, CLOCK_ZONE)}</p>
      <p className={`text-xs ${muted}`}>{occ}{operation ? ` · ${operation}` : ''}</p>
      {action && <button type="button" disabled={busy} onClick={() => onAction({ flight, intent: action, phase })}
        className={action === 'Cancel' ? dangerButton : secondaryButton}>
        {action === 'Cancel' ? 'Cancelar vuelo' : 'Terminar demo'}</button>}
    </li>
  );
}

/**
 * «Vuelo demo» of the superadministrator's «Configuración» (ADR-0041): triggers a pair of flight proposals of the
 * provider «Demo» that OCC sees coming, imports and operates like any other flight, and follows them in «Vuelos demo de
 * hoy». The phase and the countdowns are computed here each second from the server's instants and an estimate of the
 * server's clock; the list is read every `fastPollMs` while an aircraft moves (approach, taxi-in, taxi-out) and every
 * `slowPollMs` otherwise, never while the tab is hidden (contracts 2.7). The options go with the list once they are
 * `OPTIONS_MAX_AGE_MS` old, and both are read at once when the tab is back in sight (for instance after «Crear
 * cobertura» in OCC). The stands in the options are evaluated for the form's window (aircraft type, minutes to the stand
 * and on the ground): `windowDelayMs` after one of them changes the options are read again for it, and every later read
 * keeps it; a load of the Punta Cana stands reads them again too. Each command carries its intent's Idempotency-Key; a
 * 409 or a 404 reads the options (and, for a demo flight, the list) again before its message shows.
 */
export default function DemoFlightsPanel({ fastPollMs = 5000, slowPollMs = 20_000, windowDelayMs = 500, now = Date.now }) {
  const headingId = useId();
  const [stationId, setStationId] = useState(null);
  const [options, setOptions] = useState({ status: 'loading', data: null, error: null });
  const [list, setList] = useState({ status: 'loading', data: null, error: null, offset: 0, stale: false, version: 0 });
  const [clock, setClock] = useState(0);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const [create, setCreate] = useState({ busy: false, error: '', notice: '' });
  const [feedback, setFeedback] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [ending, setEnding] = useState(false);
  const clockSource = useRef(now);
  const reads = useRef(null);
  const optionsRead = useRef(0);
  /** This browser's clock when the options were last asked for. */
  const optionsAskedAt = useRef(Number.NEGATIVE_INFINITY);
  const listRead = useRef(0);
  const handledMismatch = useRef('');
  const createKeys = useRef(createCommandKeyHolder());
  const endKeys = useRef(createCommandKeyHolder());
  /** The form's window the stands are evaluated for (`windowOf`); null: the server's defaults (8 and 60 min, any size). */
  const formWindow = useRef(null);
  const windowTimer = useRef(undefined);

  useEffect(() => { clockSource.current = now; }, [now]);
  useEffect(() => () => clearTimeout(windowTimer.current), []);

  const readOptions = useCallback(async station => {
    const read = ++optionsRead.current;
    const signal = reads.current?.signal;
    // The age counts from the request: a re-read that fails is not repeated before the next one is due.
    optionsAskedAt.current = clockSource.current();
    // The stands are evaluated for the form's window once it changed; the first read of a station takes the defaults.
    const forWindow = station && formWindow.current ? formWindow.current : null;
    try {
      const data = await loadDemoFlightOptions(station, forWindow ? { signal, window: forWindow } : { signal });
      if (read === optionsRead.current && !signal?.aborted) setOptions({ status: 'success', data, error: null });
    } catch (error) {
      if (read !== optionsRead.current || signal?.aborted || error?.name === 'AbortError') return;
      // A re-read that fails keeps the form as it was; only a refusal of access replaces it.
      setOptions(current => (current.data && !denied(error) ? current : { status: 'error', data: null, error }));
    }
  }, []);

  const readList = useCallback(async station => {
    const read = ++listRead.current;
    const signal = reads.current?.signal;
    const sentAt = clockSource.current();
    try {
      const data = await listDemoFlights(station, { signal });
      const receivedAt = clockSource.current();
      if (read !== listRead.current || signal?.aborted) return;
      setClock(receivedAt);
      setList(current => ({ status: 'success', data, error: null, stale: false, version: current.version + 1,
        offset: serverClockOffset(data.serverTime, sentAt, receivedAt) }));
    } catch (error) {
      if (read !== listRead.current || signal?.aborted || error?.name === 'AbortError') return;
      // A failed poll keeps the flights on screen and says so; the next poll tries again.
      setList(current => (current.data && !denied(error)
        ? { ...current, stale: true, version: current.version + 1 }
        : { status: 'error', data: null, error, offset: 0, stale: false, version: current.version + 1 }));
    }
  }, []);

  const refreshAll = useCallback(station => Promise.all([readOptions(station), readList(station)]), [readOptions, readList]);

  useEffect(() => {
    const controller = new AbortController();
    reads.current = controller;
    void refreshAll(null);
    return () => controller.abort();
  }, [refreshAll]);

  const status = panelStatus(options, list);
  const live = status === 'ready';
  const station = stationId ?? options.data?.stationId ?? null;
  const flights = list.data?.flights ?? NO_FLIGHTS;
  const serverNow = clock + list.offset;
  const moving = live && flights.some(flight => isMoving(flight, serverNow));
  const hasActive = live && flights.some(flight => flight.state === 'Active');
  const activeNow = flights.filter(flight => flight.state === 'Active' && demoFlightPhase(flight, serverNow) !== 'Gone').length;
  const maxActive = options.data?.limits.maxActive ?? 0;
  const activeCount = flights.filter(flight => flight.state === 'Active').length;
  const mismatch = live && options.data.limits.active !== activeCount
    ? `${station}|${activeCount}|${options.data.limits.active}` : '';

  // The countdowns follow the server's clock each second while a flight is active.
  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = setInterval(() => setClock(clockSource.current()), 1000);
    return () => clearInterval(timer);
  }, [hasActive]);

  // One read at a time: the next one is scheduled once the last one settled. Options that are OPTIONS_MAX_AGE_MS old go
  // with it; so do they when this browser's clock went back, because their age is then unknown.
  useEffect(() => {
    if (!live || hidden) return undefined;
    const timer = setTimeout(() => {
      if (Math.abs(clockSource.current() - optionsAskedAt.current) >= OPTIONS_MAX_AGE_MS) void readOptions(station);
      void readList(station);
    }, moving ? fastPollMs : slowPollMs);
    return () => clearTimeout(timer);
  }, [live, hidden, moving, list.version, station, fastPollMs, slowPollMs, readOptions, readList]);

  // Hidden, the panel reads nothing; back in sight it reads the options and the list at once: a warning such as
  // crosses_local_midnight or today's airlines may have changed meanwhile.
  useEffect(() => {
    function onVisibility() {
      const nowHidden = document.visibilityState === 'hidden';
      setHidden(nowHidden);
      if (!nowHidden && live) void refreshAll(station);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [live, station, refreshAll]);

  // A flight started or ended since the options were read: the free stands and the limit are read again, once.
  useEffect(() => {
    if (!mismatch || handledMismatch.current === mismatch) return;
    handledMismatch.current = mismatch;
    void readOptions(station);
  }, [mismatch, station, readOptions]);

  function chooseStation(next) {
    // The new station's form starts from the defaults, and so does the window its stands are read for.
    clearTimeout(windowTimer.current);
    formWindow.current = null;
    setStationId(next);
    setOptions({ status: 'loading', data: null, error: null });
    setList(current => ({ status: 'loading', data: null, error: null, offset: 0, stale: false, version: current.version + 1 }));
    setCreate({ busy: false, error: '', notice: '' });
    setFeedback(null);
    void refreshAll(next);
  }

  /**
   * The form changed its window: the stands are read again for it once the values settle. A window out of range (null)
   * reads nothing, and the last one in range stays the window of every later read.
   */
  function chooseWindow(next) {
    clearTimeout(windowTimer.current);
    if (!next) return;
    formWindow.current = next;
    windowTimer.current = setTimeout(() => void readOptions(station), windowDelayMs);
  }

  /**
   * «Cargar posiciones» answered the station as it is now: the card shows it at once, and the options are read again for
   * the stands it created (located, covered, eligible) and the warnings.
   */
  async function standsLoaded(answer) {
    setOptions(current => (current.data && sameId(current.data.stationId, answer.stationId)
      ? { ...current, data: { ...current.data, layout: answer } } : current));
    await readOptions(station);
  }

  async function trigger(input) {
    setCreate({ busy: true, error: '', notice: '' });
    setFeedback(null);
    const warnings = options.data?.warnings ?? [];
    try {
      const flight = await createKeys.current.run('demo-flight.create', input, key => createDemoFlight(input, key));
      setCreate({ busy: false, error: '', notice: createdNotice(flight, warnings) });
      await refreshAll(station);
    } catch (failure) {
      // The options or the list changed (409) or the station is gone (404): both are read before the message shows.
      if (isConflict(failure) || failure?.status === 404) await refreshAll(station);
      setCreate({ busy: false, error: demoFlightMessage(failure), notice: '' });
    }
  }

  async function end() {
    const { flight, intent } = confirming;
    setEnding(true);
    setFeedback(null);
    try {
      const ended = await endKeys.current.run('demo-flight.end', { id: flight.id, intent },
        key => cancelDemoFlight(flight.id, intent, key));
      setConfirming(null);
      setFeedback({ tone: 'success', text: endedNotice(ended ?? flight, intent) });
      await refreshAll(station);
    } catch (failure) {
      setConfirming(null);
      if (isConflict(failure) || failure?.status === 404) await refreshAll(station);
      setFeedback({ tone: 'danger', text: demoFlightMessage(failure) });
    } finally {
      setEnding(false);
    }
  }

  const dialog = confirming ? confirmation(confirming) : null;
  return (
    <section aria-labelledby={headingId} className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-bold">Vuelo demo</h2>
        {options.status === 'success' && <StatusBadge tone={options.data.enabled ? 'success' : 'neutral'}
          label={options.data.enabled ? 'Disponible en este entorno' : 'No disponible en este entorno'} />}
      </div>
      <p className={`mt-1 text-xs ${muted}`}>
        Dispare un vuelo de prueba para mostrar el ciclo completo sin esperar un avión real. OCC lo ve llegar en los vuelos
        propuestos, marcado «Demo», y sigue el flujo normal: importar, asignar, operar, revisar y facturar.</p>

      {status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando vuelos demo…</p>}
      {status === 'forbidden' && <p role="alert" className="mt-3 text-sm">{demoFlightMessage(options.error ?? list.error)}</p>}
      {status === 'error' && <div role="alert" className={`mt-3 flex flex-wrap items-center justify-between gap-2 ${alertClass}`}>
        <span>{demoFlightMessage(options.error ?? list.error)}</span>
        <button type="button" onClick={() => void refreshAll(station)}
          className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button>
      </div>}
      {status === 'disabled' && <p className={`mt-3 ${warningClass}`}>
        Los vuelos demo solo funcionan en el entorno de desarrollo. Aquí están apagados.</p>}
      {status === 'noStation' && <p className={`mt-3 ${warningClass}`}>
        No hay estaciones activas. Cree o active una en «Estaciones» para disparar un vuelo demo.</p>}

      {live && options.data.layout && <div className="mt-4">
        <PuntaCanaStandsCard key={options.data.stationId} layout={options.data.layout} onLoaded={standsLoaded}
          onStale={() => readOptions(station)} />
      </div>}
      {live && (
        <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
          <DemoFlightForm key={options.data.stationId} data={options.data} standsLoadable={options.data.layout?.supported === true}
            limitReached={maxActive > 0 && activeNow >= maxActive} maxActive={maxActive} busy={create.busy}
            error={create.error} notice={create.notice} onStation={chooseStation} onSubmit={input => void trigger(input)}
            onWindow={chooseWindow} />
          <section aria-labelledby={`${headingId}-today`} className={inset}>
            <h3 id={`${headingId}-today`} className="text-base font-bold">Vuelos demo de hoy</h3>
            {feedback && <p role={feedback.tone === 'danger' ? 'alert' : 'status'}
              className={`mt-3 ${feedback.tone === 'danger' ? alertClass : successClass}`}>{feedback.text}</p>}
            {list.stale && <p role="status" className={`mt-3 text-xs ${muted}`}>
              No se pudo actualizar la lista; se intentará de nuevo en unos segundos.</p>}
            {flights.length === 0
              ? <p className={`mt-3 rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]`}>Aún no hay vuelos demo hoy.</p>
              : <ul aria-labelledby={`${headingId}-today`} className="mt-1 divide-y divide-black/5 dark:divide-white/5">
                {flights.map(flight => <DemoFlightRow key={flight.id} flight={flight} serverNow={serverNow} busy={ending}
                  onAction={setConfirming} />)}
              </ul>}
          </section>
        </div>
      )}

      <ConfirmDialog open={Boolean(dialog)} busy={ending} title={dialog?.title ?? ''} description={dialog?.description}
        confirmLabel={dialog?.confirmLabel} busyLabel={dialog?.busyLabel} cancelLabel="Volver"
        onClose={() => setConfirming(null)} onConfirm={() => void end()} />
    </section>
  );
}
