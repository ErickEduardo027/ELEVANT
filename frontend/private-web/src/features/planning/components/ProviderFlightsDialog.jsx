import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  dismissOccFlightProposal, FLIGHT_FEED_VIEWS, flightFeedMessage, importOccFlightProposals, loadOccFlightFeed,
  pauseReasonText, placementReasons, refreshOccFlightFeed, REFRESH_MESSAGES, restoreOccFlightProposal,
} from '../../../services/occFlightFeedService';
import { getManualTurnaroundOptions } from '../../../services/planningService';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { isConflict } from '../../../services/problemMessages';

const buttonClass = 'min-h-9 rounded-lg border border-accent-600/40 px-3 text-xs font-semibold text-accent-600 disabled:cursor-not-allowed disabled:opacity-50';
const primaryClass = 'min-h-9 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';
const selectClass = 'mt-1 block min-h-9 max-w-56 rounded-lg border border-black/10 px-2 dark:border-white/10 dark:bg-surface-dark-card';

const VIEW_HINTS = {
  Contracted: 'Vuelos de aerolíneas con contrato vigente ese día. Las aerolíneas con el contrato suspendido o vencido en la estación no aparecen.',
  Charter: 'Aerolíneas activas sin contrato vigente: se importan como charter sin contrato, a la tarifa estándar con prepago.',
  Dismissed: 'Propuestas descartadas. Puedes restaurarlas mientras su vuelo no haya pasado.',
};

const EMPTY_TEXT = {
  Contracted: 'No hay vuelos propuestos para esta fecha. El proveedor se consulta solo cuando hay contratos vigentes; usa «Nuevo vuelo» para crearlo a mano.',
  Charter: 'No hay vuelos de aerolíneas sin contrato propuestos para esta fecha.',
  Dismissed: 'No hay propuestas descartadas para esta fecha.',
};

function time(value, timeZone) {
  return value ? new Intl.DateTimeFormat('es-DO', { timeStyle: 'short', timeZone: timeZone ?? 'America/Santo_Domingo' })
    .format(new Date(value)) : '—';
}

function Times({ item, timeZone }) {
  return <span>
    {time(item.scheduledAt, timeZone)}
    {item.revisedAt && item.revisedAt !== item.scheduledAt && <span className="text-status-warning"> → {time(item.revisedAt, timeZone)}</span>}
    {item.runwayAt && <span className="text-status-success"> · real {time(item.runwayAt, timeZone)}</span>}
  </span>;
}

function Details({ item }) {
  return <span className="block text-xs text-text-secondary-light dark:text-text-secondary-dark">
    {item.providerStatus}{item.aircraftRegistration ? ` · ${item.aircraftRegistration}` : ''}
    {item.aircraftModel ? ` · ${item.aircraftModel}` : ''}{item.terminal ? ` · Terminal ${item.terminal}` : ''}
    {item.gate ? ` · Puerta ${item.gate}` : ''}</span>;
}

function Budget({ budget, lastReadAt, timeZone }) {
  const dayRatio = budget.dailyUnits ? budget.unitsToday / budget.dailyUnits : 0;
  const monthRatio = budget.monthlyUnits ? budget.unitsThisMonth / budget.monthlyUnits : 0;
  const tone = Math.max(dayRatio, monthRatio) >= 0.8 ? 'text-status-warning' : 'text-text-secondary-light dark:text-text-secondary-dark';
  return <div className="space-y-1 text-xs">
    {!budget.configured && <p role="status" className="rounded-lg bg-status-warning/10 px-3 py-2 text-status-warning">
      El proveedor {budget.provider} no está configurado en este entorno: no se hace ninguna llamada y solo se muestran las propuestas guardadas.</p>}
    {budget.pausedUntil && <p role="status" className="rounded-lg bg-status-warning/10 px-3 py-2 text-status-warning">
      Lecturas en pausa hasta las {time(budget.pausedUntil, timeZone)}: {pauseReasonText(budget.pauseReason)}.</p>}
    <p className={tone}>
      Unidades {budget.provider}: hoy {budget.unitsToday} de {budget.dailyUnits} · este mes {budget.unitsThisMonth} de {budget.monthlyUnits}
      {lastReadAt ? ` · última lectura ${time(lastReadAt, timeZone)}` : ' · sin lecturas todavía'}
    </p>
  </div>;
}

function typeLabel(type) {
  return `${type.manufacturer} ${type.model} · ${type.icaoCode}`;
}

/**
 * Flights the provider proposed (ADR-0028). OCC pairs each arrival with its departure and imports the turnaround with
 * its aircraft type and stand (2-B), imports a carrier without contract as a charter (ADR-0033), dismisses legs it will
 * not operate and restores a dismissed one while its flight has not passed (2-N36). Opening the dialog never calls the
 * provider; only «Actualizar ahora» may, within the server's limits.
 */
export default function ProviderFlightsDialog({ stationId, date, timeZone, onClose, onImported }) {
  const [view, setView] = useState('Contracted');
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [choices, setChoices] = useState({});
  const [catalog, setCatalog] = useState({ status: 'idle' });
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '', reasons: [] });
  const importKeys = useRef(createCommandKeyHolder());
  const restoreKeys = useRef(createCommandKeyHolder());

  useEffect(() => {
    const controller = new AbortController();
    loadOccFlightFeed(stationId, date, { signal: controller.signal, view })
      .then(data => setState({ status: 'success', view, data }))
      .catch(error => { if (error?.name !== 'AbortError') setState({ status: 'error', view, error }); });
    return () => controller.abort();
  }, [stationId, date, view, attempt]);

  const canImport = Boolean(state.data?.canImport);
  // The active aircraft types and stands of the station, the same catalogs as «Nuevo vuelo» («type once»). A re-read
  // keeps the lists on screen until the new ones arrive; the selectors appear once the first answer is in.
  useEffect(() => {
    if (!canImport || view === 'Dismissed') return undefined;
    const controller = new AbortController();
    getManualTurnaroundOptions(stationId, date, { signal: controller.signal })
      .then(options => setCatalog({ status: 'success', aircraftTypes: options.aircraftTypes ?? [], stands: options.stands ?? [] }))
      .catch(error => { if (error?.name !== 'AbortError') setCatalog({ status: 'error' }); });
    return () => controller.abort();
  }, [stationId, date, canImport, view, catalogAttempt]);

  useEffect(() => {
    function handleKey(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const current = state.view === view ? state : { status: 'loading' };
  const proposals = useMemo(() => current.data?.proposals ?? [], [current.data]);
  const openDepartures = proposals.filter(item => item.direction === 'Departure' && item.status === 'Proposed');
  const arrivals = proposals.filter(item => item.direction === 'Arrival');
  const choiceOf = arrival => ({
    departureId: choices[arrival.proposalId]?.departureId ?? arrival.suggestedDepartureId ?? '',
    aircraftTypeId: choices[arrival.proposalId]?.aircraftTypeId ??
      (catalog.aircraftTypes?.some(type => type.id === arrival.suggestedAircraftTypeId) ? arrival.suggestedAircraftTypeId : ''),
    standId: choices[arrival.proposalId]?.standId ?? '',
  });
  const choose = (arrival, field, value) => setChoices(all => ({
    ...all, [arrival.proposalId]: { ...choiceOf(arrival), ...all[arrival.proposalId], [field]: value },
  }));
  const pairedDepartures = new Set(arrivals.map(item => choiceOf(item).departureId).filter(Boolean));
  const loneDepartures = view === 'Dismissed' ? proposals.filter(item => item.direction === 'Departure')
    : openDepartures.filter(item => !pairedDepartures.has(item.proposalId));
  const nextManual = current.data?.nextManualRefreshAt;

  async function run(key, action, success) {
    setBusy(key);
    setMessage({ tone: '', text: '', reasons: [] });
    try {
      const result = await action();
      setMessage({ tone: 'success', text: typeof success === 'function' ? success(result) : success, reasons: [] });
      reload();
      return result;
    } catch (error) {
      setMessage({ tone: 'danger', text: flightFeedMessage(error),
        reasons: error?.code === 'stand_unavailable' ? placementReasons(error) : [] });
      // A changed proposal, type or stand: read the list and the catalogs again before a new attempt.
      if (isConflict(error) || error?.status === 404) { reload(); setCatalogAttempt(value => value + 1); }
      return null;
    } finally {
      setBusy('');
    }
  }

  async function importArrival(arrival) {
    const choice = choiceOf(arrival);
    const departure = openDepartures.find(item => item.proposalId === choice.departureId);
    if (!departure) return;
    const command = {
      arrivalProposalId: arrival.proposalId, departureProposalId: departure.proposalId,
      expectedArrivalVersion: arrival.version, expectedDepartureVersion: departure.version,
      aircraftTypeId: choice.aircraftTypeId || null, standId: choice.standId || null, charter: view === 'Charter',
    };
    const result = await run(`import-${arrival.proposalId}`,
      () => importKeys.current.run('import', command, key => importOccFlightProposals(command, key)),
      // 3-N07: a flight OCC already planned by hand takes the provider's proposal instead of being duplicated.
      answer => (answer.linked
        ? `La propuesta se vinculó a la escala ya planificada (${answer.operationCode}); no se creó otra.`
        : view === 'Charter'
          ? `Charter importado (${answer.operationCode}). Finanzas confirma el prepago en «Charters sin contrato».`
          : `Escala importada (${answer.operationCode}).`));
    if (result) onImported?.();
  }

  const restore = item => run(`restore-${item.proposalId}`,
    () => restoreKeys.current.run('restore', { proposalId: item.proposalId, expectedVersion: item.version },
      key => restoreOccFlightProposal(item.proposalId, item.version, key)),
    `${item.flightNumber} volvió a la revisión.`);

  const dismiss = item => run(`dismiss-${item.proposalId}`, () => dismissOccFlightProposal(item.proposalId),
    `${item.flightNumber} descartado. Puedes restaurarlo desde «Descartadas».`);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="provider-flights-title"
        className="fixed inset-x-4 top-8 bottom-8 z-50 mx-auto flex max-w-4xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-surface-dark-card">
        <header className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div>
            <h2 id="provider-flights-title" className="text-base font-semibold">Importar vuelos del proveedor</h2>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {current.data?.stationCode ?? state.data?.stationCode ?? '…'} · {date}. {VIEW_HINTS[view]}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm" aria-label="Cerrar">✕</button>
        </header>

        <nav className="flex flex-wrap gap-2 border-b border-black/5 px-5 py-2 dark:border-white/5" aria-label="Vista de vuelos propuestos">
          {FLIGHT_FEED_VIEWS.map(item => <button key={item.id} type="button" aria-pressed={view === item.id}
            onClick={() => { setView(item.id); setMessage({ tone: '', text: '', reasons: [] }); }}
            className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${view === item.id ? 'bg-accent-600 text-white' : 'border border-black/10 dark:border-white/10'}`}>
            {item.label}</button>)}
        </nav>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {current.status === 'loading' && <p role="status">Cargando vuelos propuestos…</p>}
          {current.status === 'error' && <div role="alert" className="flex flex-wrap items-center gap-3 text-status-danger">
            <p>{flightFeedMessage(current.error)}</p>
            {current.error?.status !== 403 && <button type="button" className={buttonClass} onClick={reload}>Reintentar</button>}
          </div>}
          {current.status === 'success' && <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Budget budget={current.data.budget} lastReadAt={current.data.lastReadAt} timeZone={timeZone} />
              {canImport && <button type="button" className={buttonClass}
                disabled={Boolean(busy) || !current.data.budget.configured || Boolean(nextManual && new Date(nextManual) > new Date())}
                title={nextManual ? `Disponible a las ${time(nextManual, timeZone)}` : undefined}
                onClick={() => void run('refresh', () => refreshOccFlightFeed(stationId),
                  result => REFRESH_MESSAGES[result.status] ?? 'Listo.')}>
                {busy === 'refresh' ? 'Consultando…' : 'Actualizar ahora'}</button>}
            </div>
            {message.text && <div role={message.tone === 'danger' ? 'alert' : 'status'}
              className={message.tone === 'danger' ? 'text-status-danger' : 'text-status-success'}>
              <p>{message.text}</p>
              {message.reasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">
                {message.reasons.map(text => <li key={text}>{text}</li>)}</ul>}
            </div>}
            {canImport && view !== 'Dismissed' && catalog.status === 'error' && <p role="status" className="flex flex-wrap items-center gap-2 text-xs text-status-warning">
              No se pudieron cargar los tipos de avión y las posiciones: puedes importar sin ellos y asignarlos después.
              <button type="button" className={buttonClass} onClick={() => setCatalogAttempt(value => value + 1)}>Reintentar</button></p>}

            {proposals.length === 0 ? <p role="status" className="rounded-xl bg-black/[0.03] p-4 dark:bg-white/5">{EMPTY_TEXT[view]}</p> : <>
              <h3 className="font-semibold">Llegadas ({arrivals.length})</h3>
              <ul className="space-y-2" aria-label={view === 'Dismissed' ? 'Llegadas descartadas' : 'Llegadas propuestas'}>
                {arrivals.map(arrival => {
                  const choice = choiceOf(arrival);
                  const imported = arrival.status === 'Confirmed';
                  const suggested = Boolean(arrival.suggestedAircraftTypeId) && choice.aircraftTypeId === arrival.suggestedAircraftTypeId;
                  return <li key={arrival.proposalId} className="rounded-xl border border-black/5 p-3 dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p><strong>{arrival.flightNumber}</strong> · {arrival.airlineName} · desde {arrival.counterpartIata ?? '¿?'}
                        {' · '}<Times item={arrival} timeZone={timeZone} /><Details item={arrival} /></p>
                      {imported && <span className="rounded-md bg-status-success/10 px-2 py-0.5 text-xs text-status-success">Importado</span>}
                      {view === 'Dismissed' && canImport && <button type="button" className={buttonClass} disabled={Boolean(busy)}
                        onClick={() => void restore(arrival)}>{busy === `restore-${arrival.proposalId}` ? 'Restaurando…' : 'Restaurar'}</button>}
                    </div>
                    {view !== 'Dismissed' && !imported && canImport && <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="text-xs">Sale como
                        <select className={selectClass} value={choice.departureId}
                          onChange={event => choose(arrival, 'departureId', event.target.value)}>
                          <option value="">Elige la salida…</option>
                          {openDepartures.filter(item => item.airlineId === arrival.airlineId).map(item => <option key={item.proposalId}
                            value={item.proposalId}>{item.flightNumber} · hacia {item.counterpartIata ?? '¿?'} · {time(item.scheduledAt, timeZone)}</option>)}
                        </select></label>
                      {catalog.status === 'success' && <>
                        <label className="text-xs">Tipo de avión{suggested ? ' (sugerido)' : ''}
                          <select className={selectClass} value={choice.aircraftTypeId}
                            onChange={event => choose(arrival, 'aircraftTypeId', event.target.value)}>
                            <option value="">Sin tipo de avión</option>
                            {catalog.aircraftTypes.map(type => <option key={type.id} value={type.id}>{typeLabel(type)}</option>)}
                          </select></label>
                        <label className="text-xs">Posición
                          <select className={selectClass} value={choice.standId}
                            onChange={event => choose(arrival, 'standId', event.target.value)}>
                            <option value="">Sin posición (asignar después)</option>
                            {catalog.stands.map(stand => <option key={stand.id} value={stand.id}>
                              {stand.code} · Terminal {stand.terminal?.code ?? '—'}</option>)}
                          </select></label>
                      </>}
                      <button type="button" className={primaryClass} disabled={Boolean(busy) || !choice.departureId}
                        onClick={() => void importArrival(arrival)}>
                        {busy === `import-${arrival.proposalId}` ? 'Importando…' : view === 'Charter' ? 'Importar como charter' : 'Importar escala'}</button>
                      <button type="button" className={buttonClass} disabled={Boolean(busy)}
                        onClick={() => void dismiss(arrival)}>Descartar</button>
                      {!arrival.counterpartKnown && <p className="text-xs text-status-warning">Aeropuerto de origen aún desconocido.</p>}
                    </div>}
                  </li>;
                })}
              </ul>
              {loneDepartures.length > 0 && <>
                <h3 className="font-semibold">{view === 'Dismissed' ? 'Salidas descartadas' : 'Salidas sin llegada'} ({loneDepartures.length})</h3>
                <ul className="space-y-2" aria-label={view === 'Dismissed' ? 'Salidas descartadas' : 'Salidas sin llegada'}>
                  {loneDepartures.map(item => <li key={item.proposalId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 p-3 dark:border-white/10">
                    <p><strong>{item.flightNumber}</strong> · {item.airlineName} · hacia {item.counterpartIata ?? '¿?'} · <Times item={item} timeZone={timeZone} /></p>
                    {canImport && (view === 'Dismissed'
                      ? <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => void restore(item)}>
                        {busy === `restore-${item.proposalId}` ? 'Restaurando…' : 'Restaurar'}</button>
                      : <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => void dismiss(item)}>Descartar</button>)}
                  </li>)}
                </ul>
              </>}
            </>}
          </>}
        </div>
      </section>
    </>
  );
}
