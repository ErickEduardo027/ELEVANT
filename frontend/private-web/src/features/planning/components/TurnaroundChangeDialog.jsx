import { useEffect, useMemo, useRef, useState } from 'react';
import { getManualTurnaroundOptions } from '../../../services/planningService';
import { stationLocalToUtc, utcToStationLocalInput } from '../../../services/businessDay';
import { problemMessage } from '../../../services/problemMessages';
import { placementReasons } from '../../../services/occFlightFeedService';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages, TURNAROUND_PROBLEM_MESSAGES, TURNAROUND_REASON_MESSAGES } from '../planningMessages';
import { usePlanningTurnaround } from '../usePlanningTurnaround';

const DAY = 24 * 60 * 60 * 1000;
const TITLES = { reschedule: 'change.rescheduleTitle', cancel: 'change.cancelTitle', divert: 'change.divertTitle' };
const HINTS = { reschedule: 'change.rescheduleHint', cancel: 'change.cancelHint', divert: 'change.divertHint' };
const SUBMITS = { reschedule: 'change.submitReschedule', cancel: 'change.submitCancel', divert: 'change.submitDivert' };

const fieldClass = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent-600 focus:ring-2 focus:ring-accent-600/20 dark:border-white/15 dark:bg-surface-dark-card dark:text-text-primary-dark';
const labelClass = 'block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark';

/** The form of «Editar vuelo» prefilled from the flight as the server has it, its times in the station's local time. */
function formFrom(detail) {
  const zone = detail.station?.ianaTimeZone ?? null;
  const { arrival, departure } = detail.turnaround;
  return {
    arrivalFlightNumber: arrival?.flightNumber ?? '',
    arrivalOriginIata: arrival?.origin?.iataCode ?? '',
    arrivalScheduledAt: utcToStationLocalInput(arrival?.scheduledAt, zone),
    departureFlightNumber: departure?.flightNumber ?? '',
    departureDestinationIata: departure?.destination?.iataCode ?? '',
    departureScheduledAt: utcToStationLocalInput(departure?.scheduledAt, zone),
    standId: '',
    aircraftTypeId: '',
    reason: '',
  };
}

/** Why the server refused the change, in Spanish: the code, then the rules it breaks (stand, agent). */
function failureMessage(error) {
  const message = problemMessage(error, TURNAROUND_PROBLEM_MESSAGES);
  const reasons = error?.code === 'stand_unavailable'
    ? placementReasons(error)
    : error?.code === 'assigned_agent_unavailable'
      ? (error.reasons ?? []).map(reason => TURNAROUND_REASON_MESSAGES[reason]).filter(Boolean)
      : [];
  return reasons.length ? `${message} (${reasons.join('; ')})` : message;
}

/**
 * «Editar vuelo», «Cancelar vuelo» and «Marcar desviado» (3-A): the dialog reads the flight with its ETag and the
 * changes the server allows now, and sends the change with the intent's Idempotency-Key. Times are typed in the
 * station's local time and travel in UTC (3-N19). Nothing is deleted: the server keeps the history and the reason.
 */
export default function TurnaroundChangeDialog({ turnaroundId, mode, onChanged, onClose }) {
  const { t } = useTranslation(planningMessages);
  const turnaround = usePlanningTurnaround(turnaroundId);
  // What OCC typed; until then the form shows the flight as the server has it.
  const [edited, setEdited] = useState(null);
  // The station's stands, aircraft types and airports, tagged with the station and day they belong to.
  const [catalog, setCatalog] = useState({ key: null, data: null });
  const [failure, setFailure] = useState('');
  const [refreshed, setRefreshed] = useState(false);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const detail = turnaround.detail;
  const zone = detail?.station?.ianaTimeZone ?? null;
  const station = detail?.station?.code ?? t('manual.theStation');
  const allowed = turnaround.allowedActions.includes(mode);
  const busy = turnaround.submitting;
  const titleId = `turnaround-change-title-${mode}`;

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  // The form follows the flight as read until OCC types in it; from then on a re-read keeps what OCC typed.
  const initialForm = useMemo(() => (detail ? formFrom(detail) : null), [detail]);
  const form = edited ?? initialForm;

  // Stands, aircraft types and airports of the station for «Editar vuelo»; without them the current ones are kept.
  const stationId = detail?.station?.id;
  const operationDate = detail?.turnaround?.operationDate;
  const catalogKey = mode === 'reschedule' && stationId && operationDate ? `${stationId}|${operationDate}` : null;
  useEffect(() => {
    if (!catalogKey) return undefined;
    const controller = new AbortController();
    getManualTurnaroundOptions(stationId, operationDate, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setCatalog({ key: catalogKey, data }); })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setCatalog({ key: catalogKey, data: null });
      });
    return () => controller.abort();
  }, [catalogKey, stationId, operationDate]);
  // Another station's or day's catalog is never offered.
  const options = catalog.key === catalogKey ? catalog.data : null;

  function update(name, value) {
    setEdited(current => ({ ...(current ?? initialForm), [name]: value }));
    setFailure('');
  }

  function rescheduleCommand() {
    const arrivalScheduledAt = stationLocalToUtc(form.arrivalScheduledAt, zone);
    const departureScheduledAt = stationLocalToUtc(form.departureScheduledAt, zone);
    const span = Date.parse(departureScheduledAt) - Date.parse(arrivalScheduledAt);
    const iata = value => value.trim().toUpperCase();
    const flight = value => value.replace(/\s+/g, '').toUpperCase();
    if (!arrivalScheduledAt || !departureScheduledAt || !(span > 0 && span <= DAY) ||
        !/^[A-Z0-9]{2,16}$/.test(flight(form.arrivalFlightNumber)) ||
        !/^[A-Z0-9]{2,16}$/.test(flight(form.departureFlightNumber)) ||
        !/^[A-Z]{3}$/.test(iata(form.arrivalOriginIata)) || !/^[A-Z]{3}$/.test(iata(form.departureDestinationIata)))
      return null;
    return {
      arrivalFlightNumber: flight(form.arrivalFlightNumber), arrivalOriginIata: iata(form.arrivalOriginIata),
      arrivalScheduledAt,
      departureFlightNumber: flight(form.departureFlightNumber), departureDestinationIata: iata(form.departureDestinationIata),
      departureScheduledAt,
      standId: form.standId || null, aircraftTypeId: form.aircraftTypeId || null, reason: form.reason.trim(),
    };
  }

  async function submit(event) {
    event.preventDefault();
    if (!form || !allowed || busy) return;
    const reason = form.reason.trim();
    if (reason.length < 5 || reason.length > 500) {
      setFailure(TURNAROUND_PROBLEM_MESSAGES.reason_required);
      return;
    }
    const command = mode === 'reschedule' ? rescheduleCommand() : { reason };
    if (!command) {
      setFailure(t('change.invalid'));
      return;
    }
    setFailure('');
    setRefreshed(false);
    const outcome = await turnaround.submit(mode, command);
    if (outcome.ok) {
      onChanged(mode, outcome.detail.turnaround.operationCode);
      return;
    }
    if (outcome.error?.name === 'AbortError' || !outcome.error) return;
    setRefreshed(outcome.refreshed);
    setFailure(failureMessage(outcome.error));
  }

  function handleKeys(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = Array.from(dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? []);
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

  const current = detail?.turnaround;
  const airports = (options?.airports ?? []).filter(airport => airport.iataCode !== options?.stationAirport?.iataCode);
  const stands = options?.stands ?? [];
  const types = options?.aircraftTypes ?? [];
  const datalistId = `turnaround-change-airports-${turnaroundId}`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/60 p-3 sm:p-6">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeys}
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/15 bg-white p-5 shadow-2xl dark:bg-surface-dark-card sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-600">{t('change.eyebrow')}</p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink-900 dark:text-text-primary-dark">{t(TITLES[mode])}</h2>
            {current && <p className="mt-1 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">{current.operationCode}</p>}
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{t(HINTS[mode])}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-sm text-ink-900 disabled:opacity-50 dark:border-white/15 dark:text-text-primary-dark">{t('change.close')}</button>
        </div>

        {turnaround.status === 'loading' && !form &&
          <p role="status" className="mt-5 text-sm text-text-secondary-light">{t('change.loading')}</p>}
        {turnaround.status === 'error' &&
          <div role="alert" className="mt-5 rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger">
            {t('change.loadError')}
            <button type="button" onClick={turnaround.reload} className="ml-3 font-semibold underline">{t('change.retry')}</button>
          </div>}
        {['unauthorized', 'forbidden', 'not-found'].includes(turnaround.status) &&
          <p role="alert" className="mt-5 rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger">
            {problemMessage(turnaround.error, TURNAROUND_PROBLEM_MESSAGES)}</p>}

        {form && turnaround.status !== 'unauthorized' && turnaround.status !== 'forbidden' && turnaround.status !== 'not-found' &&
          <form onSubmit={submit} className="mt-5 space-y-4" aria-busy={busy}>
            {turnaround.status === 'success' && !allowed &&
              <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">{t('change.notAllowed')}</p>}
            {mode === 'reschedule' && <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelClass}>{t('change.arrivalFlight')}
                  <input required maxLength={20} value={form.arrivalFlightNumber} onChange={event => update('arrivalFlightNumber', event.target.value)} className={`${fieldClass} mt-1`} />
                </label>
                <label className={labelClass}>{t('change.arrivalOrigin')}
                  <input required maxLength={3} list={datalistId} value={form.arrivalOriginIata} onChange={event => update('arrivalOriginIata', event.target.value)} className={`${fieldClass} mt-1 uppercase`} />
                </label>
                <label className={labelClass}>{t('change.departureFlight')}
                  <input required maxLength={20} value={form.departureFlightNumber} onChange={event => update('departureFlightNumber', event.target.value)} className={`${fieldClass} mt-1`} />
                </label>
                <label className={labelClass}>{t('change.departureDestination')}
                  <input required maxLength={3} list={datalistId} value={form.departureDestinationIata} onChange={event => update('departureDestinationIata', event.target.value)} className={`${fieldClass} mt-1 uppercase`} />
                </label>
                <label className={labelClass}>{t('change.arrivalScheduled', { station })}
                  <input required type="datetime-local" value={form.arrivalScheduledAt} onChange={event => update('arrivalScheduledAt', event.target.value)} className={`${fieldClass} mt-1`} />
                </label>
                <label className={labelClass}>{t('change.departureScheduled', { station })}
                  <input required type="datetime-local" value={form.departureScheduledAt} onChange={event => update('departureScheduledAt', event.target.value)} className={`${fieldClass} mt-1`} />
                </label>
                <label className={labelClass}>{t('change.stand')}
                  <select value={form.standId} onChange={event => update('standId', event.target.value)} className={`${fieldClass} mt-1`}>
                    <option value="">{current?.stand?.code ? `${t('change.keepStand')} (${current.stand.code})` : t('change.keepStand')}</option>
                    {stands.filter(stand => stand.id !== current?.stand?.id).map(stand =>
                      <option key={stand.id} value={stand.id}>{t('manual.standOption', { code: stand.code, terminal: stand.terminal?.code ?? '—' })}</option>)}
                  </select>
                </label>
                <label className={labelClass}>{t('change.aircraftType')}
                  <select value={form.aircraftTypeId} onChange={event => update('aircraftTypeId', event.target.value)} className={`${fieldClass} mt-1`}>
                    <option value="">{current?.aircraft?.icaoCode ? `${t('change.keepAircraftType')} (${current.aircraft.icaoCode})` : t('change.keepAircraftType')}</option>
                    {types.filter(type => type.id !== current?.aircraft?.id).map(type =>
                      <option key={type.id} value={type.id}>{t('manual.aircraftTypeOption', { manufacturer: type.manufacturer, model: type.model, code: type.icaoCode })}</option>)}
                  </select>
                </label>
              </div>
              <datalist id={datalistId}>
                {airports.map(airport => <option key={airport.id} value={airport.iataCode}>{airport.name}</option>)}
              </datalist>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('change.localHint', { station, zone: zone ?? t('manual.stationZone') })}</p>
            </>}
            <label className={labelClass}>{t('change.reason')}
              <textarea required minLength={5} maxLength={500} rows={3} value={form.reason}
                onChange={event => update('reason', event.target.value)} aria-describedby={`${titleId}-reason-hint`} className={`${fieldClass} mt-1`} />
            </label>
            <p id={`${titleId}-reason-hint`} className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('change.reasonHint')}</p>
            {refreshed && <p role="status" className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-sm text-ink-900">{t('change.refreshed')}</p>}
            {failure && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/5 p-3 text-sm text-status-danger">{failure}</p>}
            <div className="flex flex-wrap justify-end gap-2 border-t border-black/10 pt-4 dark:border-white/10">
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold text-ink-900 disabled:opacity-50 dark:border-white/15 dark:text-text-primary-dark">{t('change.close')}</button>
              <button type="submit" disabled={!allowed || busy || turnaround.status !== 'success'}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'reschedule' ? 'bg-accent-600' : 'bg-status-danger'}`}>
                {busy ? t('change.submitting') : t(SUBMITS[mode])}
              </button>
            </div>
          </form>}
      </section>
    </div>
  );
}
