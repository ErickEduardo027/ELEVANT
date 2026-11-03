import { useState } from 'react';
import { assignOccStand, locateOccStand, recordOccArrival, releaseOccStand } from '../../../services/occPositionsService';

const inputClass = 'w-full rounded-lg border border-black/10 px-2 py-1.5 text-xs dark:border-white/10 dark:bg-surface-dark-card';
const buttonClass = 'rounded-lg border border-accent-600/40 px-3 py-1.5 text-xs font-semibold text-accent-600 disabled:opacity-50';

function time(value) {
  return value ? new Intl.DateTimeFormat('es-DO', { timeStyle: 'short', timeZone: 'America/Santo_Domingo' }).format(new Date(value)) : '—';
}

/**
 * OCC actions on a real stand (teacher review, Phase 7): register the arrival of the aircraft
 * parked here, release the stand when it leaves, or bring a flight of the day to this stand.
 * Every command returns the refreshed board, which the map re-reads.
 */
export default function PositionActions({ position, candidates = [], onChanged, onStartPlacing, operationDate }) {
  const [registration, setRegistration] = useState({});
  const [turnaroundId, setTurnaroundId] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });

  async function run(key, command, success) {
    setBusy(key);
    setMessage({ tone: '', text: '' });
    try {
      await command();
      setMessage({ tone: 'success', text: success });
      onChanged?.();
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message });
    } finally {
      setBusy('');
    }
  }

  const parked = position.turnarounds ?? [];
  const movable = candidates.filter(item => !parked.some(here => here.turnaroundId === item.turnaroundId));

  return (
    <section aria-label="Acciones de la posición" className="space-y-3 rounded-lg border border-black/10 p-3 text-xs dark:border-white/10">
      <h3 className="text-sm font-semibold">Acciones OCC</h3>
      <div className="space-y-2 border-b border-black/5 pb-3 dark:border-white/5">
        <p className="text-text-secondary-light dark:text-text-secondary-dark">
          {position.locationSource === 'occ'
            ? `Ubicación registrada por OCC (${Number(position.latitude).toFixed(5)}, ${Number(position.longitude).toFixed(5)}).`
            : 'Ubicación de referencia interna, sin verificar. Ubícala en el mapa para que OCC y Planificación usen la real.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {onStartPlacing && <button type="button" className={buttonClass} disabled={Boolean(busy)}
            onClick={() => onStartPlacing(position)}>Ubicar en el mapa</button>}
          {position.locationSource === 'occ' && operationDate && <button type="button" className={buttonClass} disabled={Boolean(busy)}
            onClick={() => void run('clear-location', () => locateOccStand(position.standId, null, null, operationDate),
              `Se quitó la ubicación de ${position.id}.`)}>
            {busy === 'clear-location' ? 'Quitando…' : 'Quitar ubicación'}</button>}
        </div>
      </div>
      {parked.map(item => (
        <div key={item.turnaroundId} className="space-y-2 border-b border-black/5 pb-3 last:border-0 dark:border-white/5">
          <p><strong>{item.arrivalFlightNumber ?? item.operationCode}</strong> · {item.airlineName}
            <span className="block text-text-secondary-light">Llegada prevista {time(item.arrivalScheduledAt)}
              {item.arrivedAt ? ` · llegó ${time(item.arrivedAt)}` : ' · aún no ha llegado'}</span></p>
          {!item.arrivedAt && (
            <form className="flex items-end gap-2" noValidate onSubmit={event => {
              event.preventDefault();
              const value = (registration[item.turnaroundId] ?? item.aircraftRegistration ?? '').trim();
              void run(`arrival-${item.turnaroundId}`, () => recordOccArrival(item.turnaroundId, value),
                `Llegada registrada: ${value.toUpperCase()} en ${position.id}.`);
            }}>
              <label className="flex-1">Matrícula
                <input className={inputClass} value={registration[item.turnaroundId] ?? item.aircraftRegistration ?? ''}
                  onChange={event => setRegistration(current => ({ ...current, [item.turnaroundId]: event.target.value }))}
                  placeholder="HI1055" maxLength={10} /></label>
              <button type="submit" className={buttonClass} disabled={Boolean(busy)}>
                {busy === `arrival-${item.turnaroundId}` ? 'Registrando…' : 'Registrar llegada'}</button>
            </form>
          )}
          <button type="button" className={buttonClass} disabled={Boolean(busy)}
            onClick={() => void run(`release-${item.turnaroundId}`, () => releaseOccStand(item.turnaroundId), `${position.id} quedó libre.`)}>
            {busy === `release-${item.turnaroundId}` ? 'Liberando…' : 'Liberar posición'}</button>
        </div>
      ))}
      {movable.length > 0 && (
        <form className="space-y-2" noValidate onSubmit={event => {
          event.preventDefault();
          if (!turnaroundId) { setMessage({ tone: 'danger', text: 'Elige el vuelo que ocupará esta posición.' }); return; }
          void run('assign', () => assignOccStand(turnaroundId, position.standId), `Vuelo asignado a ${position.id}.`)
            .then(() => setTurnaroundId(''));
        }}>
          <label className="block">Asignar un vuelo del día a {position.id}
            <select className={inputClass} value={turnaroundId} onChange={event => setTurnaroundId(event.target.value)}>
              <option value="">Selecciona un vuelo…</option>
              {movable.map(item => <option key={item.turnaroundId} value={item.turnaroundId}>
                {(item.arrivalFlightNumber ?? item.operationCode)} · {item.airlineName} · {time(item.arrivalScheduledAt)}
                {item.standCode ? ` (ahora en ${item.standCode})` : ''}</option>)}
            </select></label>
          <button type="submit" className={buttonClass} disabled={Boolean(busy)}>{busy === 'assign' ? 'Asignando…' : 'Asignar posición'}</button>
        </form>
      )}
      {message.text && <p role={message.tone === 'danger' ? 'alert' : 'status'}
        className={message.tone === 'danger' ? 'text-status-danger' : 'text-status-success'}>{message.text}</p>}
    </section>
  );
}
