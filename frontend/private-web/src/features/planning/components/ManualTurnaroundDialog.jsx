import { useEffect, useRef, useState } from 'react';
import { createCharterAirline, createManualTurnaround, getManualTurnaroundOptions } from '../../../services/planningService';
import { stationLocalToUtc } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { problemMessage } from '../../../services/problemMessages';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages, TURNAROUND_PROBLEM_MESSAGES } from '../planningMessages';

function newUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const EMPTY_FORM = {
  airlineId: '', standId: '', aircraftTypeId: '', arrivalFlightNumber: '', arrivalOriginIata: '', arrivalScheduledAt: '',
  departureFlightNumber: '', departureDestinationIata: '', departureScheduledAt: '',
};

const fieldClass = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent-600 focus:ring-2 focus:ring-accent-600/20 dark:border-white/15 dark:bg-surface-dark-card dark:text-text-primary-dark';
const EMPTY_CHARTER_AIRLINE = { name: '', icaoCode: '', iataCode: '' };

/**
 * The minimal carrier of a charter that is not registered yet (3-N21): name, ICAO designator and optional IATA one.
 * Contratos completes it if the airline later signs a contract; a code already registered is never duplicated.
 */
function CharterAirlineForm({ onCreated, onExisting, onCancel }) {
  const { t } = useTranslation(planningMessages);
  const [airline, setAirline] = useState(EMPTY_CHARTER_AIRLINE);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const keys = useRef(createCommandKeyHolder());
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  async function register() {
    if (status === 'submitting') return;
    const command = { name: airline.name, icaoCode: airline.icaoCode, iataCode: airline.iataCode || null };
    setStatus('submitting');
    setError('');
    try {
      const created = await keys.current.run('create-charter-airline', command,
        idempotencyKey => createCharterAirline(command, idempotencyKey));
      setStatus('idle');
      onCreated(created);
    } catch (failure) {
      setStatus('idle');
      if (failure?.code === 'airline_code_in_use') {
        setError(onExisting(command) ?? '');
        return;
      }
      setError(problemMessage(failure, TURNAROUND_PROBLEM_MESSAGES));
    }
  }

  const update = (name, value) => {
    setAirline(current => ({ ...current, [name]: value }));
    setError('');
  };
  // Enter registers the airline instead of submitting the flight around it.
  const onKeyDown = event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void register();
  };

  return (
    <div role="group" aria-labelledby="charter-airline-title" className="mt-2 space-y-2 rounded-lg border border-accent-600/20 bg-accent-600/5 p-3">
      <p id="charter-airline-title" className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{t('manual.charterAirlineTitle')}</p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('manual.charterAirlineHint')}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark sm:col-span-3">{t('manual.charterAirlineName')}
          <input ref={nameRef} maxLength={160} value={airline.name} onKeyDown={onKeyDown} onChange={event => update('name', event.target.value)} className={`${fieldClass} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.charterAirlineIcao')}
          <input maxLength={3} value={airline.icaoCode} onKeyDown={onKeyDown} onChange={event => update('icaoCode', event.target.value.toUpperCase())} className={`${fieldClass} mt-1 font-mono uppercase`} />
        </label>
        <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.charterAirlineIata')}
          <input maxLength={2} value={airline.iataCode} onKeyDown={onKeyDown} onChange={event => update('iataCode', event.target.value.toUpperCase())} className={`${fieldClass} mt-1 font-mono uppercase`} />
        </label>
      </div>
      {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={status === 'submitting'} className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-semibold text-ink-900 disabled:opacity-50 dark:border-white/15 dark:text-text-primary-dark">{t('manual.charterAirlineCancel')}</button>
        <button type="button" onClick={() => void register()} disabled={status === 'submitting'} className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {status === 'submitting' ? t('manual.charterAirlineSubmitting') : t('manual.charterAirlineSubmit')}</button>
      </div>
    </div>
  );
}

export default function ManualTurnaroundDialog({ stationId, initialDate, onCreated, onClose }) {
  const { t } = useTranslation(planningMessages);
  const [date, setDate] = useState(initialDate);
  const [form, setForm] = useState(EMPTY_FORM);
  const [options, setOptions] = useState(null);
  const [optionsStatus, setOptionsStatus] = useState('loading');
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [submitStatus, setSubmitStatus] = useState('idle');
  const [formError, setFormError] = useState('');
  const [charter, setCharter] = useState(false);
  const [showCharterAirline, setShowCharterAirline] = useState(false);
  const [charterNotice, setCharterNotice] = useState('');
  // The carrier just registered (3-N21) is selected once the options read after it list it.
  const pendingAirlineId = useRef(null);
  const airlineChoices = (charter ? options?.charterAirlines : options?.airlines) ?? [];
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
        const pending = pendingAirlineId.current;
        pendingAirlineId.current = null;
        if (pending && (value.charterAirlines ?? []).some(airline => airline.id === pending)) {
          idempotencyId.current = null;
          setForm(current => ({ ...current, airlineId: pending }));
        }
      })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setOptionsStatus(error?.status === 401 ? 'unauthorized' : error?.status === 403 ? 'forbidden' : 'error');
      });
    return () => controller.abort();
  }, [stationId, date, optionsRetry]);

  function charterAirlineCreated(airline) {
    setShowCharterAirline(false);
    setCharterNotice(t('manual.charterAirlineCreated', { name: airline.name }));
    pendingAirlineId.current = airline.id;
    setOptionsRetry(value => value + 1);
  }

  /** A code already registered: the airline is selected when it can fly as a charter, never duplicated. */
  function charterAirlineExisting(command) {
    const iata = command.iataCode?.trim().toUpperCase() ?? '';
    const name = command.name.trim().split(/\s+/).join(' ').toLowerCase();
    const matches = airline => (iata && airline.iataCode === iata) || airline.name.toLowerCase() === name;
    const charterMatch = (options?.charterAirlines ?? []).find(matches);
    if (charterMatch) {
      setShowCharterAirline(false);
      setCharterNotice(t('manual.charterAirlineExisting'));
      updateField('airlineId', charterMatch.id);
      return null;
    }
    if ((options?.airlines ?? []).some(matches)) return t('manual.charterAirlineContracted');
    // Registered meanwhile under another name: the list is read again so OCC can pick it.
    setOptionsRetry(value => value + 1);
    return t('manual.charterAirlineInUse');
  }

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
    if (optionsStatus !== 'success' || !airlineChoices.length || submitStatus === 'submitting') return;
    // Typed in the station's local time, sent in UTC (3-N19).
    const zone = options?.station?.ianaTimeZone ?? null;
    const arrival = new Date(stationLocalToUtc(form.arrivalScheduledAt, zone) ?? Number.NaN);
    const departure = new Date(stationLocalToUtc(form.departureScheduledAt, zone) ?? Number.NaN);
    if (!form.airlineId || !form.standId || !form.arrivalOriginIata || !form.departureDestinationIata ||
        Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime()) ||
        departure <= arrival || departure - arrival > 24 * 60 * 60 * 1000) {
      setFormError('manual.invalid');
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
        charter,
        // Typed once here, the aircraft type sizes the stand and the ground time later (2-A).
        aircraftTypeId: form.aircraftTypeId || null,
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSubmitStatus('success');
      onCreated(date, result.operationCode);
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      setSubmitStatus('error');
      setFormError(error?.status === 401
        ? 'manual.sessionEnded'
        : error?.status === 403
          ? 'manual.forbidden'
          : error?.problemCode === 'aircraft_type_unavailable'
            ? 'manual.aircraftTypeUnavailable'
          : error?.problemCode === 'stand_unavailable'
            ? 'manual.standTooSmall'
          : error?.problemCode === 'flight_already_planned'
            ? 'manual.flightAlreadyPlanned'
          : error?.status === 409
            ? 'manual.conflict'
            : 'manual.error');
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
  const stationLabel = options?.station?.code ?? t('manual.theStation');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-3 sm:p-6">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="manual-turnaround-title"
        onKeyDown={handleKeys}
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-white p-5 shadow-2xl dark:bg-surface-dark-card sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-600">{t('manual.eyebrow')}</p>
            <h2 id="manual-turnaround-title" className="mt-1 text-xl font-semibold text-ink-900 dark:text-text-primary-dark">{t('manual.title')}</h2>
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('manual.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('manual.closeLabel')}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-ink-900 dark:border-white/15 dark:text-text-primary-dark">{t('manual.close')}</button>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.operationalDate')}
              <input ref={dateRef} type="date" required value={date} onChange={event => updateDate(event.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t(charter ? 'manual.charterAirline' : 'manual.airline')}
              <select required value={form.airlineId} onChange={event => updateField('airlineId', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">{t('manual.selectAirline')}</option>
                {airlineChoices.map(airline => <option key={airline.id} value={airline.id}>{airline.name} · {airline.iataCode}</option>)}
              </select>
            </label>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium text-ink-900 dark:text-text-primary-dark">
                <input type="checkbox" checked={charter} onChange={event => {
                  setCharter(event.target.checked); setShowCharterAirline(false); setCharterNotice(''); updateField('airlineId', '');
                }}
                  className="h-4 w-4 rounded border-black/20 text-accent-600 focus:ring-accent-600" />
                {t('manual.charterToggle')}
              </label>
              {charter && <p className="mt-1 text-xs text-status-warning">{t(airlineChoices.length ? 'manual.charterHint' : 'manual.noCharterAirlines')}</p>}
              {charter && charterNotice && <p role="status" className="mt-1 text-xs font-semibold text-accent-600">{charterNotice}</p>}
              {charter && optionsStatus === 'success' && !showCharterAirline &&
                <button type="button" onClick={() => { setShowCharterAirline(true); setCharterNotice(''); }}
                  className="mt-1 text-xs font-semibold text-accent-600 underline">{t('manual.newCharterAirline')}</button>}
              {charter && showCharterAirline &&
                <CharterAirlineForm onCreated={charterAirlineCreated} onExisting={charterAirlineExisting}
                  onCancel={() => setShowCharterAirline(false)} />}
            </div>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.stand')}
              <select required value={form.standId} onChange={event => updateField('standId', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">{t('manual.selectStand')}</option>
                {(options?.stands ?? []).map(stand => <option key={stand.id} value={stand.id}>{t('manual.standOption', { code: stand.code, terminal: stand.terminal?.code ?? '—' })}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.aircraftType')}
              <select value={form.aircraftTypeId} onChange={event => updateField('aircraftTypeId', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">{t('manual.noAircraftType')}</option>
                {(options?.aircraftTypes ?? []).map(type => <option key={type.id} value={type.id}>{t('manual.aircraftTypeOption', { manufacturer: type.manufacturer, model: type.model, code: type.icaoCode })}</option>)}
              </select>
            </label>
          </div>

          {optionsStatus === 'loading' && <p role="status" className="text-sm text-text-secondary-light">{t('manual.loading')}</p>}
          {optionsStatus === 'success' && options?.airlines.length === 0 &&
            <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">{t('manual.noAirlines')}</p>}
          {optionsStatus === 'success' && selectableAirports.length === 0 &&
            <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">{t('manual.noAirports')}</p>}
          {optionsStatus === 'success' && !options?.stands.length &&
            <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">{t('manual.noStands')}</p>}
          {['error', 'unauthorized', 'forbidden'].includes(optionsStatus) &&
            <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger">
              {optionsStatus === 'unauthorized' ? t('manual.optionsUnauthorized') : optionsStatus === 'forbidden'
                ? t('manual.optionsForbidden') : t('manual.optionsError')}
              {optionsStatus === 'error' && <button type="button" onClick={() => setOptionsRetry(value => value + 1)} className="ml-3 font-semibold underline">{t('manual.retry')}</button>}
            </div>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.arrivalFlight')}
              <input required maxLength={20} value={form.arrivalFlightNumber} onChange={event => updateField('arrivalFlightNumber', event.target.value)} placeholder="EV 311" className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.arrivalOrigin')}
              <select required value={form.arrivalOriginIata} onChange={event => updateField('arrivalOriginIata', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">{t('manual.selectAirport')}</option>
                {selectableAirports.map(airport => <option key={airport.id} value={airport.iataCode}>{airport.iataCode} · {airport.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.departureFlight')}
              <input required maxLength={20} value={form.departureFlightNumber} onChange={event => updateField('departureFlightNumber', event.target.value)} placeholder="EV 312" className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.departureDestination')}
              <select required value={form.departureDestinationIata} onChange={event => updateField('departureDestinationIata', event.target.value)} className={`${fieldClass} mt-1`}>
                <option value="">{t('manual.selectAirport')}</option>
                {selectableAirports.map(airport => <option key={airport.id} value={airport.iataCode}>{airport.iataCode} · {airport.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.arrivalScheduled', { station: stationLabel })}
              <input required type="datetime-local" value={form.arrivalScheduledAt} onChange={event => updateField('arrivalScheduledAt', event.target.value)} className={`${fieldClass} mt-1`} />
            </label>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{t('manual.departureScheduled', { station: stationLabel })}
              <input required type="datetime-local" value={form.departureScheduledAt} onChange={event => updateField('departureScheduledAt', event.target.value)} className={`${fieldClass} mt-1`} />
            </label>
          </div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('manual.localHint', { station: stationLabel, zone: options?.station?.ianaTimeZone ?? t('manual.stationZone') })}</p>
          {formError && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger">{t(formError)}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
            <button type="button" onClick={onClose} className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold text-ink-900 dark:border-white/15 dark:text-text-primary-dark">{t('manual.cancel')}</button>
            <button type="submit" disabled={optionsStatus !== 'success' || !airlineChoices.length || !options?.stands.length || !selectableAirports.length || submitStatus === 'submitting'}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {submitStatus === 'submitting' ? t('manual.submitting') : t('manual.submit')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
