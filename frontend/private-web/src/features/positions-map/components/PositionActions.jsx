import { useId, useRef, useState } from 'react';
import {
  assignOccStand, isStalePosition, locateOccStand, recordOccArrival, releaseOccStand,
} from '../../../services/occPositionsService';
import { BUSINESS_TIME_ZONE, stationLocalToUtc, utcToStationLocalInput } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { useArrivalAircraftTypes, usePositionTurnarounds } from '../usePositionTurnarounds';

const inputClass = 'w-full rounded-lg border border-black/10 px-2 py-1.5 text-xs dark:border-white/10 dark:bg-surface-dark-card';
const buttonClass = 'rounded-lg border border-accent-600/40 px-3 py-1.5 text-xs font-semibold text-accent-600 disabled:opacity-50';
const REGISTRATION = /^[A-Z0-9-]{2,10}$/;

/** A clock time in the station's zone (3-N19); AVIAM's calendar until the flight's station is known. */
function formatTime(value, timeZone) {
  if (!value) return '—';
  const format = zone => new Intl.DateTimeFormat('es-DO', { timeStyle: 'short', timeZone: zone }).format(new Date(value));
  try {
    return format(timeZone ?? BUSINESS_TIME_ZONE);
  } catch {
    return format(BUSINESS_TIME_ZONE);
  }
}

/**
 * The arrival OCC records on the stand (3-N08), or its correction: the registration, the actual on-block time typed in
 * the station's local time (now by default) and, optionally, the aircraft type seen (3-B). A correction needs its
 * reason; the server allows it only before the first submission.
 */
function ArrivalForm({ item, correcting, zone, station, catalog, current, busy, onSubmit, onCancel }) {
  const id = useId();
  const [registration, setRegistration] = useState(item.aircraftRegistration ?? '');
  const [arrivedAt, setArrivedAt] = useState(() => utcToStationLocalInput(item.arrivedAt ?? new Date(), zone));
  const [aircraftTypeId, setAircraftTypeId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const action = correcting ? 'correction' : 'arrival';

  function submit(event) {
    event.preventDefault();
    const value = registration.trim().toUpperCase();
    if (!REGISTRATION.test(value)) {
      setError('Revisa la matrícula: usa solo letras, números o guion (por ejemplo HI1055).');
      return;
    }
    const at = arrivedAt ? stationLocalToUtc(arrivedAt, zone) : null;
    if (arrivedAt && !at) {
      setError('Revisa la hora de llegada.');
      return;
    }
    const note = reason.trim();
    if (correcting && (note.length < 5 || note.length > 500)) {
      setError('Indica el motivo de la corrección (entre 5 y 500 caracteres).');
      return;
    }
    setError('');
    onSubmit({ aircraftRegistration: value, arrivedAt: at, aircraftTypeId: aircraftTypeId || null,
      reason: correcting ? note : null });
  }

  const label = station ? `Hora real de llegada (hora local de ${station})` : 'Hora real de llegada (hora local de la estación)';
  return (
    <form className="space-y-2" noValidate onSubmit={submit} aria-label={correcting ? 'Corregir llegada' : 'Registrar llegada'}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-registration`} className="block">Matrícula</label>
          <input id={`${id}-registration`} className={inputClass} value={registration} placeholder="HI1055" maxLength={10}
            onChange={event => { setRegistration(event.target.value); setError(''); }} />
        </div>
        <div>
          <label htmlFor={`${id}-arrived`} className="block">{label}</label>
          <input id={`${id}-arrived`} type="datetime-local" className={inputClass} value={arrivedAt}
            onChange={event => { setArrivedAt(event.target.value); setError(''); }} />
        </div>
      </div>
      {catalog.status === 'success' && catalog.types.length > 0 && (
        <div>
          <label htmlFor={`${id}-type`} className="block">Tipo de avión (opcional)</label>
          <select id={`${id}-type`} className={inputClass} value={aircraftTypeId}
            onChange={event => { setAircraftTypeId(event.target.value); setError(''); }}>
            <option value="">{current?.aircraft?.icaoCode ? `Mantener el actual (${current.aircraft.icaoCode})` : 'Sin indicar'}</option>
            {catalog.types.filter(type => type.id !== current?.aircraft?.id).map(type =>
              <option key={type.id} value={type.id}>{type.manufacturer} {type.model} · {type.icaoCode}</option>)}
          </select>
        </div>
      )}
      {correcting && (
        <div>
          <label htmlFor={`${id}-reason`} className="block">Motivo de la corrección</label>
          <textarea id={`${id}-reason`} className={inputClass} rows={2} maxLength={500} value={reason}
            onChange={event => { setReason(event.target.value); setError(''); }} />
        </div>
      )}
      {error && <p role="alert" className="text-status-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={Boolean(busy)}>
          {busy === `${action}:${item.turnaroundId}` ? 'Guardando…' : correcting ? 'Guardar corrección' : 'Registrar llegada'}</button>
        {onCancel && <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={onCancel}>Cancelar</button>}
      </div>
    </form>
  );
}

/**
 * OCC actions on a real stand (teacher review, Phase 7): register the arrival of the aircraft parked here at its local
 * time and correct it with a reason (3-N08), release the stand when it leaves, or bring a flight of the day to this
 * stand. Each command carries the intent's Idempotency-Key and the flight's ETag when OCC can read its detail (3-N10);
 * after a 409/412 the flight and the board are read again. Every command returns the refreshed board.
 */
export default function PositionActions({ position, candidates = [], onChanged, onStartPlacing, operationDate }) {
  const [turnaroundId, setTurnaroundId] = useState('');
  const [busy, setBusy] = useState('');
  const [correcting, setCorrecting] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });
  const keys = useRef(createCommandKeyHolder());

  const parked = position.turnarounds ?? [];
  const movable = candidates.filter(item => !parked.some(here => here.turnaroundId === item.turnaroundId));
  const { versions, reload } = usePositionTurnarounds([...parked.map(item => item.turnaroundId), turnaroundId]);
  const known = Object.values(versions).find(version => version?.detail)?.detail;
  const zone = known?.station?.ianaTimeZone ?? null;
  const station = known?.station?.code ?? null;
  const recordable = item => !item.arrivedAt || item.status === 'Scheduled' || item.status === 'Confirmed';
  const catalog = useArrivalAircraftTypes(known?.station?.id ?? null, parked.some(recordable) || Boolean(correcting));

  /** Sends one intent with its key and the ETag read when it was first tried; a retry repeats both. */
  async function run(action, body, flightId, command, success) {
    setBusy(action);
    setMessage({ tone: '', text: '' });
    try {
      await keys.current.run(action, body, (idempotencyKey, ifMatch) => command({ ifMatch, idempotencyKey }),
        () => versions[flightId]?.etag ?? null);
      setMessage({ tone: 'success', text: success });
      setCorrecting('');
      reload();
      onChanged?.();
      return true;
    } catch (error) {
      setMessage({ tone: 'danger', text: error.message });
      // The flight moved or the stand was taken meanwhile: read the flight and the board before a new intent.
      if (isStalePosition(error)) {
        reload();
        onChanged?.();
      }
      return false;
    } finally {
      setBusy('');
    }
  }

  async function arrival(item, value, correction) {
    const action = `${correction ? 'correction' : 'arrival'}:${item.turnaroundId}`;
    await run(action, value, item.turnaroundId, headers => recordOccArrival(item.turnaroundId, value, headers),
      correction ? `Llegada corregida: ${value.aircraftRegistration} en ${position.id}.`
        : `Llegada registrada: ${value.aircraftRegistration} en ${position.id}.`);
  }

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
            onClick={() => void run('clear-location', { standId: position.standId }, null,
              () => locateOccStand(position.standId, null, null, operationDate), `Se quitó la ubicación de ${position.id}.`)}>
            {busy === 'clear-location' ? 'Quitando…' : 'Quitar ubicación'}</button>}
        </div>
      </div>
      {parked.map(item => {
        const version = versions[item.turnaroundId];
        const loading = !version || version.status === 'loading';
        const current = version?.detail?.turnaround ?? null;
        const correctable = Boolean(item.arrivedAt) && !recordable(item) &&
          (version?.detail?.allowedActions ?? []).includes('correctArrival');
        return (
          <div key={item.turnaroundId} className="space-y-2 border-b border-black/5 pb-3 last:border-0 dark:border-white/5">
            <p><strong>{item.arrivalFlightNumber ?? item.operationCode}</strong> · {item.airlineName}
              <span className="block text-text-secondary-light">Llegada prevista {formatTime(item.arrivalScheduledAt, zone)}
                {item.arrivedAt ? ` · llegó ${formatTime(item.arrivedAt, zone)}` : ' · aún no ha llegado'}</span></p>
            {loading && <p role="status" className="text-text-secondary-light">Consultando la versión del vuelo…</p>}
            {!loading && recordable(item) &&
              <ArrivalForm item={item} correcting={false} zone={zone} station={station} catalog={catalog} current={current}
                busy={busy} onSubmit={value => void arrival(item, value, false)} />}
            {!loading && correctable && correcting !== item.turnaroundId &&
              <button type="button" className={buttonClass} disabled={Boolean(busy)}
                onClick={() => { setCorrecting(item.turnaroundId); setMessage({ tone: '', text: '' }); }}>Corregir llegada</button>}
            {!loading && correctable && correcting === item.turnaroundId &&
              <ArrivalForm item={item} correcting zone={zone} station={station} catalog={catalog} current={current} busy={busy}
                onSubmit={value => void arrival(item, value, true)} onCancel={() => setCorrecting('')} />}
            <button type="button" className={buttonClass} disabled={Boolean(busy)}
              onClick={() => void run(`release:${item.turnaroundId}`, { turnaroundId: item.turnaroundId }, item.turnaroundId,
                headers => releaseOccStand(item.turnaroundId, headers), `${position.id} quedó libre.`)}>
              {busy === `release:${item.turnaroundId}` ? 'Liberando…' : 'Liberar posición'}</button>
          </div>
        );
      })}
      {movable.length > 0 && (
        <form className="space-y-2" noValidate onSubmit={event => {
          event.preventDefault();
          if (!turnaroundId) { setMessage({ tone: 'danger', text: 'Elige el vuelo que ocupará esta posición.' }); return; }
          void run(`assign:${turnaroundId}`, { turnaroundId, standId: position.standId }, turnaroundId,
            headers => assignOccStand(turnaroundId, position.standId, null, headers), `Vuelo asignado a ${position.id}.`)
            .then(done => { if (done) setTurnaroundId(''); });
        }}>
          <label className="block">Asignar un vuelo del día a {position.id}
            <select className={inputClass} value={turnaroundId} onChange={event => setTurnaroundId(event.target.value)}>
              <option value="">Selecciona un vuelo…</option>
              {movable.map(item => <option key={item.turnaroundId} value={item.turnaroundId}>
                {(item.arrivalFlightNumber ?? item.operationCode)} · {item.airlineName} · {formatTime(item.arrivalScheduledAt, zone)}
                {item.standCode ? ` (ahora en ${item.standCode})` : ''}</option>)}
            </select></label>
          <button type="submit" className={buttonClass} disabled={Boolean(busy)}>{busy === `assign:${turnaroundId}` ? 'Asignando…' : 'Asignar posición'}</button>
        </form>
      )}
      {message.text && <p role={message.tone === 'danger' ? 'alert' : 'status'}
        className={message.tone === 'danger' ? 'text-status-danger' : 'text-status-success'}>{message.text}</p>}
    </section>
  );
}
