import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  dismissOccFlightProposal, importOccFlight, loadOccFlightFeed, refreshOccFlightFeed, REFRESH_MESSAGES,
} from '../../../services/occFlightFeedService';

const buttonClass = 'min-h-9 rounded-lg border border-accent-600/40 px-3 text-xs font-semibold text-accent-600 disabled:cursor-not-allowed disabled:opacity-50';
const primaryClass = 'min-h-9 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50';

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

function Budget({ budget, lastReadAt, timeZone }) {
  const dayRatio = budget.dailyUnits ? budget.unitsToday / budget.dailyUnits : 0;
  const monthRatio = budget.monthlyUnits ? budget.unitsThisMonth / budget.monthlyUnits : 0;
  const tone = Math.max(dayRatio, monthRatio) >= 0.8 ? 'text-status-warning' : 'text-text-secondary-light dark:text-text-secondary-dark';
  return <div className="space-y-1 text-xs">
    {!budget.configured && <p role="status" className="rounded-lg bg-status-warning/10 px-3 py-2 text-status-warning">
      El proveedor {budget.provider} no está configurado en este entorno: no se hace ninguna llamada y solo se muestran las propuestas guardadas.</p>}
    {budget.pausedUntil && <p role="status" className="rounded-lg bg-status-warning/10 px-3 py-2 text-status-warning">
      Lecturas en pausa hasta las {time(budget.pausedUntil, timeZone)} ({budget.pauseReason ?? 'error del proveedor'}).</p>}
    <p className={tone}>
      Unidades {budget.provider}: hoy {budget.unitsToday} de {budget.dailyUnits} · este mes {budget.unitsThisMonth} de {budget.monthlyUnits}
      {lastReadAt ? ` · última lectura ${time(lastReadAt, timeZone)}` : ' · sin lecturas todavía'}
    </p>
  </div>;
}

/**
 * Flights the paid provider proposed for contracted airlines (ADR-0028). OCC pairs each arrival
 * with its departure and imports the turnaround, or dismisses legs it will not operate. Opening
 * the dialog never calls the provider; only «Actualizar ahora» may, within the server's limits.
 */
export default function ProviderFlightsDialog({ stationId, date, timeZone, onClose, onImported }) {
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pairs, setPairs] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });

  useEffect(() => {
    const controller = new AbortController();
    loadOccFlightFeed(stationId, date, { signal: controller.signal })
      .then(data => setState({ status: 'success', data }))
      .catch(error => { if (error?.name !== 'AbortError') setState({ status: 'error', error }); });
    return () => controller.abort();
  }, [stationId, date, attempt]);

  useEffect(() => {
    function handleKey(event) { if (event.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const proposals = useMemo(() => state.data?.proposals ?? [], [state.data]);
  const openDepartures = proposals.filter(item => item.direction === 'Departure' && item.status === 'Proposed');
  const arrivals = proposals.filter(item => item.direction === 'Arrival');
  const pairedDepartures = new Set(arrivals.map(item => pairs[item.proposalId] ?? item.suggestedDepartureId).filter(Boolean));
  const loneDepartures = openDepartures.filter(item => !pairedDepartures.has(item.proposalId));
  const canImport = Boolean(state.data?.canImport);
  const nextManual = state.data?.nextManualRefreshAt;

  async function run(key, action, success) {
    setBusy(key);
    setMessage({ tone: '', text: '' });
    try {
      const result = await action();
      setMessage({ tone: 'success', text: typeof success === 'function' ? success(result) : success });
      reload();
      return result;
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message });
      return null;
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm" onClick={onClose} />
      <section role="dialog" aria-modal="true" aria-labelledby="provider-flights-title"
        className="fixed inset-x-4 top-8 bottom-8 z-50 mx-auto flex max-w-4xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-surface-dark-card">
        <header className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div>
            <h2 id="provider-flights-title" className="text-base font-semibold">Importar vuelos del proveedor</h2>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {state.data?.stationCode ?? '…'} · {date}. Solo aparecen vuelos de aerolíneas con contrato vigente ese día.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm" aria-label="Cerrar">✕</button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {state.status === 'loading' && <p role="status">Cargando vuelos propuestos…</p>}
          {state.status === 'error' && <div role="alert" className="flex flex-wrap items-center gap-3 text-status-danger">
            <p>{state.error.message}</p>
            {state.error.status !== 403 && <button type="button" className={buttonClass} onClick={reload}>Reintentar</button>}
          </div>}
          {state.status === 'success' && <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Budget budget={state.data.budget} lastReadAt={state.data.lastReadAt} timeZone={timeZone} />
              {canImport && <button type="button" className={buttonClass}
                disabled={Boolean(busy) || !state.data.budget.configured || Boolean(nextManual && new Date(nextManual) > new Date())}
                title={nextManual ? `Disponible a las ${time(nextManual, timeZone)}` : undefined}
                onClick={() => void run('refresh', () => refreshOccFlightFeed(stationId),
                  result => REFRESH_MESSAGES[result.status] ?? 'Listo.')}>
                {busy === 'refresh' ? 'Consultando…' : 'Actualizar ahora'}</button>}
            </div>
            {message.text && <p role={message.tone === 'danger' ? 'alert' : 'status'}
              className={message.tone === 'danger' ? 'text-status-danger' : 'text-status-success'}>{message.text}</p>}

            {proposals.length === 0 ? <p role="status" className="rounded-xl bg-black/[0.03] p-4 dark:bg-white/5">
              No hay vuelos propuestos para esta fecha. El proveedor se consulta solo cuando hay contratos vigentes; usa «Nuevo vuelo» para crearlo a mano.</p> : <>
              <h3 className="font-semibold">Llegadas ({arrivals.length})</h3>
              <ul className="space-y-2" aria-label="Llegadas propuestas">
                {arrivals.map(arrival => {
                  const departureId = pairs[arrival.proposalId] ?? arrival.suggestedDepartureId ?? '';
                  const imported = arrival.status === 'Confirmed';
                  return <li key={arrival.proposalId} className="rounded-xl border border-black/5 p-3 dark:border-white/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p><strong>{arrival.flightNumber}</strong> · {arrival.airlineName} · desde {arrival.counterpartIata ?? '¿?'}
                        {' · '}<Times item={arrival} timeZone={timeZone} />
                        <span className="block text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          {arrival.providerStatus}{arrival.aircraftRegistration ? ` · ${arrival.aircraftRegistration}` : ''}
                          {arrival.aircraftModel ? ` · ${arrival.aircraftModel}` : ''}{arrival.terminal ? ` · Terminal ${arrival.terminal}` : ''}
                          {arrival.gate ? ` · Puerta ${arrival.gate}` : ''}</span></p>
                      {imported && <span className="rounded-md bg-status-success/10 px-2 py-0.5 text-xs text-status-success">Importado</span>}
                    </div>
                    {!imported && canImport && <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="text-xs">Sale como
                        <select className="mt-1 block min-h-9 rounded-lg border border-black/10 px-2 dark:border-white/10 dark:bg-surface-dark-card"
                          value={departureId} onChange={event => setPairs(current => ({ ...current, [arrival.proposalId]: event.target.value }))}>
                          <option value="">Elige la salida…</option>
                          {openDepartures.filter(item => item.airlineId === arrival.airlineId).map(item => <option key={item.proposalId}
                            value={item.proposalId}>{item.flightNumber} · hacia {item.counterpartIata ?? '¿?'} · {time(item.scheduledAt, timeZone)}</option>)}
                        </select></label>
                      <button type="button" className={primaryClass} disabled={Boolean(busy) || !departureId}
                        onClick={() => void run(`import-${arrival.proposalId}`, () => importOccFlight(arrival.proposalId, departureId),
                          result => `Escala importada (${result.operationCode}).`).then(result => { if (result) onImported?.(); })}>
                        {busy === `import-${arrival.proposalId}` ? 'Importando…' : 'Importar escala'}</button>
                      <button type="button" className={buttonClass} disabled={Boolean(busy)}
                        onClick={() => void run(`dismiss-${arrival.proposalId}`, () => dismissOccFlightProposal(arrival.proposalId),
                          `${arrival.flightNumber} descartado.`)}>Descartar</button>
                      {!arrival.counterpartKnown && <p className="text-xs text-status-warning">Aeropuerto de origen aún desconocido.</p>}
                    </div>}
                  </li>;
                })}
              </ul>
              {loneDepartures.length > 0 && <>
                <h3 className="font-semibold">Salidas sin llegada ({loneDepartures.length})</h3>
                <ul className="space-y-2" aria-label="Salidas sin llegada">
                  {loneDepartures.map(item => <li key={item.proposalId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 p-3 dark:border-white/10">
                    <p><strong>{item.flightNumber}</strong> · {item.airlineName} · hacia {item.counterpartIata ?? '¿?'} · <Times item={item} timeZone={timeZone} /></p>
                    {canImport && <button type="button" className={buttonClass} disabled={Boolean(busy)}
                      onClick={() => void run(`dismiss-${item.proposalId}`, () => dismissOccFlightProposal(item.proposalId),
                        `${item.flightNumber} descartado.`)}>Descartar</button>}
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
