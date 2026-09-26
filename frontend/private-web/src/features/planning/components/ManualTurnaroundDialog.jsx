import { useEffect, useRef, useState } from 'react';
import { createManualTurnaround, getManualTurnaroundOptions } from '../../../services/planningService';

function newUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const EMPTY_FORM = {
  airlineId: '', standId: '', arrivalFlightNumber: '', arrivalOriginIata: '', arrivalScheduledAt: '',
  departureFlightNumber: '', departureDestinationIata: '', departureScheduledAt: '',
};

const fieldClass = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent-600 focus:ring-2 focus:ring-accent-600/20 dark:border-white/15 dark:bg-surface-dark-card dark:text-text-primary-dark';

export default function ManualTurnaroundDialog({ stationId, initialDate, onCreated, onClose }) {
  const [date, setDate] = useState(initialDate);
  const [form, setForm] = useState(EMPTY_FORM);
  const [options, setOptions] = useState(null);
  const [optionsStatus, setOptionsStatus] = useState('loading');
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [submitStatus, setSubmitStatus] = useState('idle');
  const [formError, setFormError] = useState('');
  const idempotencyId = useRef(null);
  const dialogRef = useRef(null);
  const dateRef = useRef(null);
  const submitController = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    dateRef.current?.focus();
    return () => {
      submitController.current?.abort();
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!stationId || !date) return undefined;
    const controller = new AbortController();
    setOptionsStatus('loading');
    setOptions(null);
    getManualTurnaroundOptions(stationId, date, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        setOptions(value);
        setOptionsStatus('success');
      })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setOptionsStatus(error?.status === 401 ? 'unauthorized' : error?.status === 403 ? 'forbidden' : 'error');
      });
    return () => controller.abort();
  }, [stationId, date, optionsRetry]);

  function updateField(name, value) {
    idempotencyId.current = null;
    setForm(current => ({ ...current, [name]: value }));
    setFormError('');
  }

  function updateDate(value) {
    idempotencyId.current = null;
    setDate(value);
    setFormError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (optionsStatus !== 'success' || !options?.airlines.length || submitStatus === 'submitting') return;
    const arrival = new Date(`${form.arrivalScheduledAt}:00.000Z`);
    const departure = new Date(`${form.departureScheduledAt}:00.000Z`);
    if (!form.airlineId || !form.standId || !form.arrivalOriginIata || !form.departureDestinationIata ||
        Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime()) ||
        departure <= arrival || departure - arrival > 24 * 60 * 60 * 1000) {
      setFormError('Revise la aerolínea, los aeropuertos y el intervalo UTC de la escala.');
      return;
    }
    const controller = new AbortController();
    submitController.current = controller;
    idempotencyId.current ??= newUuid();
    setSubmitStatus('submitting');
    setFormError('');
    try {
      const result = await createManualTurnaround({
        turnaroundId: idempotencyId.current,
        stationId, airlineId: form.airlineId, standId: form.standId,
        operationDate: date,
        arrivalFlightNumber: form.arrivalFlightNumber,
        arrivalOriginIata: form.arrivalOriginIata,
        arrivalScheduledAt: arrival.toISOString(),
        departureFlightNumber: form.departureFlightNumber,
        departureDestinationIata: form.departureDestinationIata,
        departureScheduledAt: departure.toISOString(),
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSubmitStatus('success');
      onCreated(date, result.operationCode);
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      setSubmitStatus('error');
      setFormError(error?.status === 401
        ? 'La sesión terminó. Inicie sesión nuevamente.'
        : error?.status === 403
          ? 'Ya no tiene permiso para crear vuelos en esta estación.'
          : error?.status === 409
            ? 'El vuelo o su contrato cambiaron. Revise los datos antes de intentar otra vez.'
            : 'No se pudo confirmar el vuelo. Reintente con los mismos datos para comprobar el resultado.');
    }
  }

  function handleKeys(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
    if (event.key !== 'Tab') return;
    const elements = Array.from(dialogRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? []);
    if (!elements.length) return;
    const first = elements[0];
    const last = elements.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const selectableAirports = (options?.airports ?? []).filter(airport =>
    airport.iataCode !== options?.stationAirport?.iataCode);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-3 sm:p-6">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="manual-turnaround-title"
        onKeyDown={handleKeys}
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-white p-5 shadow-2xl dark:bg-surface-dark-card sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-600">Registro manual · OCC</p>
            <h2 id="manual-turnaround-title" className="mt-1 text-xl font-semibold text-ink-900 dark:text-text-primary-dark">Nuevo vuelo</h2>
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">La API comprobará el contrato y el alcance de estación antes de crear la escala.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar nuevo vuelo"
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-ink-900 dark:border-white/15 dark:text-text-primary-dark">Cerrar</button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Fecha operativa
              <input ref={dateRef} type="date" required value={date} onChange={event => updateDate(event.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Aerolínea contratada
              <select required value={form.airlineId} onChange={event => updateField('airlineId', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">Seleccione aerolínea</option>
                {(options?.airlines ?? []).map(airline => <option key={airline.id} value={airline.id}>{airline.name} · {airline.iataCode}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Posición de estacionamiento
              <select required value={form.standId} onChange={event => updateField('standId', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">Seleccione posición</option>
                {(options?.stands ?? []).map(stand => <option key={stand.id} value={stand.id}>{stand.code} · Terminal {stand.terminal?.code ?? '—'}</option>)}
              </select>
            </label>
          </div>

          {optionsStatus === 'loading' && <p role="status" className="text-sm text-text-secondary-light">Consultando contratos y aeropuertos…</p>}
          {optionsStatus === 'success' && options?.airlines.length === 0 &&
            <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">No hay aerolíneas con contrato vigente para esta fecha y estación.</p>}
          {optionsStatus === 'success' && selectableAirports.length === 0 &&
            <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">No hay otros aeropuertos en el catálogo para trazar el vuelo.</p>}
          {optionsStatus === 'success' && !options?.stands.length &&
            <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">No hay posiciones activas con terminal en esta estación.</p>}
          {['error', 'unauthorized', 'forbidden'].includes(optionsStatus) &&
            <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger">
              {optionsStatus === 'unauthorized' ? 'La sesión terminó.' : optionsStatus === 'forbidden'
                ? 'Ya no tiene acceso a esta estación.' : 'No se pudieron cargar las opciones del vuelo.'}
              {optionsStatus === 'error' && <button type="button" onClick={() => setOptionsRetry(value => value + 1)} className="ml-3 font-semibold underline">Reintentar</button>}
            </div>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Vuelo de llegada
              <input required maxLength={20} value={form.arrivalFlightNumber} onChange={event => updateField('arrivalFlightNumber', event.target.value)} placeholder="EV 311" className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Origen de llegada
              <select required value={form.arrivalOriginIata} onChange={event => updateField('arrivalOriginIata', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">Seleccione aeropuerto</option>
                {selectableAirports.map(airport => <option key={airport.id} value={airport.iataCode}>{airport.iataCode} · {airport.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Vuelo de salida
              <input required maxLength={20} value={form.departureFlightNumber} onChange={event => updateField('departureFlightNumber', event.target.value)} placeholder="EV 312" className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Destino de salida
              <select required value={form.departureDestinationIata} onChange={event => updateField('departureDestinationIata', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">Seleccione aeropuerto</option>
                {selectableAirports.map(airport => <option key={airport.id} value={airport.iataCode}>{airport.iataCode} · {airport.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Llegada programada (UTC)
              <input required type="datetime-local" value={form.arrivalScheduledAt} onChange={event => updateField('arrivalScheduledAt', event.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Salida programada (UTC)
              <input required type="datetime-local" value={form.departureScheduledAt} onChange={event => updateField('departureScheduledAt', event.target.value)} className={`${fieldClass} mt-1`} />
            </label>
          </div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Las horas se introducen en UTC; la fecha operativa corresponde al día local de llegada en {options?.station?.code ?? 'la estación'} ({options?.station?.ianaTimeZone ?? 'zona de estación'}).</p>
          {formError && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger">{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <button type="button" onClick={onClose} className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold text-ink-900 dark:border-white/15 dark:text-text-primary-dark">Cancelar</button>
            <button type="submit" disabled={optionsStatus !== 'success' || !options?.airlines.length || !options?.stands.length || !selectableAirports.length || submitStatus === 'submitting'}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {submitStatus === 'submitting' ? 'Creando…' : 'Crear vuelo'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
