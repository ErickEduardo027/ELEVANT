import { useEffect, useId, useRef, useState } from 'react';
import DemoTag from '../../occ-ui/DemoTag';
import {
  assignOccStand, isStalePosition, locateOccStand, positionVersionMessage, recordOccArrival, releaseOccStand,
} from '../../../services/occPositionsService';
import { BUSINESS_TIME_ZONE, stationLocalToUtc, utcToStationLocalInput } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { useArrivalAircraftTypes, usePositionTurnarounds } from '../usePositionTurnarounds';
import { useTranslation } from '../../../i18n/LanguageScope';
import { occButtonClass } from '../../occ-ui/OccButton';
import { occControlClass } from '../../occ-ui/OccField';
import { positionsMapMessages } from '../positionsMapMessages';

// Painted with the occ tokens (design E.3): the controls of OccField, the secondary key of OccButton, its faint look
// while disabled.
const inputClass = `w-full ${occControlClass({ kind: 'input' })}`;
const selectClass = `w-full ${occControlClass({ kind: 'select' })}`;
const textareaClass = `w-full ${occControlClass({ kind: 'textarea' })}`;
const buttonClass = `${occButtonClass({ variant: 'secondary', size: 'sm' })} disabled:cursor-not-allowed disabled:text-occ-faint`;
const LABEL = 'block text-xs font-medium text-occ-muted';
const REGISTRATION = /^[A-Z0-9-]{2,10}$/;
/** How often an untouched arrival time follows the clock. */
const CLOCK_TICK_MS = 15_000;

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

/** The current instant (ms), refreshed every few seconds while `running`. */
function useClock(running) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/**
 * Why the commands of a flight wait (3-N10): its version is being read, it could not be read (a recoverable error with
 * «Reintentar») or the account may not read it. Nothing while the flight is read now or read again.
 */
function VersionNotice({ version, onRetry }) {
  const { t } = useTranslation(positionsMapMessages);
  const status = version?.status ?? 'loading';
  if (status === 'loading') {
    return <p role="status" className="text-occ-muted">{t('actions.versionLoading')}</p>;
  }
  if (status === 'forbidden') return <p role="alert" className="text-occ-danger">{positionVersionMessage({ status: 403 })}</p>;
  if (status !== 'error') return null;
  return (
    <div className="space-y-1">
      <p role="alert" className="text-occ-danger">{positionVersionMessage(version.error)}</p>
      <button type="button" className={buttonClass} onClick={onRetry}>{t('actions.retry')}</button>
    </div>
  );
}

/**
 * The arrival OCC records on the stand (3-N08), or its correction: the registration, the actual on-block time typed in
 * the station's local time and, optionally, the aircraft type seen (3-B). Untouched, the time is the one already on the
 * flight or, without one, the moment it is saved: it follows the clock and travels empty, so the server records its own
 * «now». Replacing a time already on the flight (OCC's record, or the one the provider reported) needs its reason; the
 * server allows recording and correcting only before the first submission.
 */
function ArrivalForm({ item, correcting, zone, station, catalog, current, busy, ready, onSubmit, onCancel }) {
  const { t } = useTranslation(positionsMapMessages);
  const id = useId();
  const [registration, setRegistration] = useState(item.aircraftRegistration ?? '');
  // What OCC typed in the time field; null while untouched.
  const [typed, setTyped] = useState(null);
  const [aircraftTypeId, setAircraftTypeId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const recorded = item.arrivedAt ?? null;
  const recordedInput = recorded ? utcToStationLocalInput(recorded, zone) : '';
  const now = useClock(!recorded && typed === null);
  const shown = typed ?? (recorded ? recordedInput : utcToStationLocalInput(new Date(now), zone));
  // OCC typed another time than the one on the flight.
  const changed = typed !== null && typed !== recordedInput;
  const needsReason = correcting || (Boolean(recorded) && changed);
  const action = correcting ? 'correction' : 'arrival';

  function submit(event) {
    event.preventDefault();
    const value = registration.trim().toUpperCase();
    if (!REGISTRATION.test(value)) {
      setError(t('actions.registrationInvalid'));
      return;
    }
    // Unchanged: the time on the flight as it is, or none so the server records the moment it saves.
    const at = changed && typed ? stationLocalToUtc(typed, zone) : changed ? null : recorded;
    if (changed && typed && !at) {
      setError(t('actions.timeInvalid'));
      return;
    }
    const note = reason.trim();
    if (needsReason && (note.length < 5 || note.length > 500)) {
      setError(t(correcting ? 'actions.correctionReasonInvalid' : 'actions.changeReasonInvalid'));
      return;
    }
    setError('');
    onSubmit({ aircraftRegistration: value, arrivedAt: at, aircraftTypeId: aircraftTypeId || null,
      reason: needsReason ? note : null });
  }

  const label = station ? t('actions.arrivedLabelStation', { station }) : t('actions.arrivedLabel');
  const hint = correcting ? null
    : recorded ? t('actions.arrivedRecorded', { time: formatTime(recorded, zone) })
      : typed === null ? t('actions.arrivedUntouched') : null;
  return (
    <form className="space-y-2" noValidate onSubmit={submit} aria-label={t(correcting ? 'actions.correctArrival' : 'actions.recordArrival')}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-registration`} className={LABEL}>{t('actions.registration')}</label>
          <input id={`${id}-registration`} className={inputClass} value={registration} placeholder="HI1055" maxLength={10}
            onChange={event => { setRegistration(event.target.value); setError(''); }} />
        </div>
        <div>
          <label htmlFor={`${id}-arrived`} className={LABEL}>{label}</label>
          <input id={`${id}-arrived`} type="datetime-local" className={inputClass} value={shown}
            aria-describedby={hint ? `${id}-hint` : undefined}
            onChange={event => { setTyped(event.target.value); setError(''); }} />
        </div>
      </div>
      {hint && <p id={`${id}-hint`} className="text-occ-muted">{hint}</p>}
      {catalog.status === 'success' && catalog.types.length > 0 && (
        <div>
          <label htmlFor={`${id}-type`} className={LABEL}>{t('actions.aircraftType')}</label>
          <select id={`${id}-type`} className={selectClass} value={aircraftTypeId}
            onChange={event => { setAircraftTypeId(event.target.value); setError(''); }}>
            <option value="">{current?.aircraft?.icaoCode ? t('actions.keepType', { code: current.aircraft.icaoCode }) : t('actions.noType')}</option>
            {catalog.types.filter(type => type.id !== current?.aircraft?.id).map(type =>
              <option key={type.id} value={type.id}>{type.manufacturer} {type.model} · {type.icaoCode}</option>)}
          </select>
        </div>
      )}
      {needsReason && (
        <div>
          <label htmlFor={`${id}-reason`} className={LABEL}>{t(correcting ? 'actions.correctionReason' : 'actions.changeReason')}</label>
          <textarea id={`${id}-reason`} className={textareaClass} rows={2} maxLength={500} value={reason}
            onChange={event => { setReason(event.target.value); setError(''); }} />
        </div>
      )}
      {error && <p role="alert" className="text-occ-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={Boolean(busy) || !ready}>
          {busy === `${action}:${item.turnaroundId}` ? t('actions.saving')
            : t(correcting ? 'actions.saveCorrection' : 'actions.recordArrival')}</button>
        {onCancel && <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={onCancel}>{t('actions.cancel')}</button>}
      </div>
    </form>
  );
}

/**
 * OCC actions on a real stand (teacher review, Phase 7): register the arrival of the aircraft parked here at its local
 * time and correct it with a reason (3-N08), release the stand when it leaves, or bring a flight of the day to this
 * stand. Each command carries the intent's Idempotency-Key and the ETag of the flight's version (3-N10), so a flight
 * takes commands only once that version is read: while it is read the actions wait, and a version that could not be
 * read offers «Reintentar» (or explains the missing permission) instead. After a 409/412/428 the flight and the board
 * are read again. Every command returns the refreshed board.
 */
export default function PositionActions({ position, candidates = [], onChanged, onStartPlacing, operationDate }) {
  const { t } = useTranslation(positionsMapMessages);
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
  /** The flight's version was read now: its commands carry that ETag. */
  const ready = flightId => versions[flightId]?.status === 'success' && Boolean(versions[flightId]?.etag);

  /**
   * Sends one intent with its key and the ETag read when it was first tried; a retry repeats both. A flight's command
   * waits for its version: none is sent without its key and the version it expects.
   */
  async function run(action, body, flightId, command, success) {
    if (flightId && !ready(flightId)) return false;
    setBusy(action);
    setMessage({ tone: '', text: '' });
    try {
      await keys.current.run(action, body, (idempotencyKey, ifMatch) => command({ ifMatch, idempotencyKey }),
        () => (flightId ? versions[flightId].etag : null));
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
      t(correction ? 'actions.arrivalCorrected' : 'actions.arrivalRecorded',
        { registration: value.aircraftRegistration, position: position.id }));
  }

  const selected = turnaroundId ? versions[turnaroundId] : null;
  return (
    <section aria-label={t('actions.label')} className="space-y-3 rounded border border-occ-line p-3 text-sm text-occ-text">
      <h3 className="text-sm font-semibold">{t('actions.title')}</h3>
      <div className="space-y-2 border-b border-occ-line pb-3">
        <p className="text-occ-muted">
          {position.locationSource === 'occ'
            ? t('actions.locationOcc', { latitude: Number(position.latitude).toFixed(5),
              longitude: Number(position.longitude).toFixed(5) })
            : t(position.locationSource === 'none' ? 'actions.locationNone' : 'actions.locationReference')}
        </p>
        <div className="flex flex-wrap gap-2">
          {onStartPlacing && <button type="button" className={buttonClass} disabled={Boolean(busy)}
            onClick={() => onStartPlacing(position)}>{t('actions.place')}</button>}
          {position.locationSource === 'occ' && operationDate && <button type="button" className={buttonClass} disabled={Boolean(busy)}
            onClick={() => void run('clear-location', { standId: position.standId }, null,
              () => locateOccStand(position.standId, null, null, operationDate),
              t('actions.locationCleared', { position: position.id }))}>
            {busy === 'clear-location' ? t('actions.clearingLocation') : t('actions.clearLocation')}</button>}
        </div>
      </div>
      {parked.map(item => {
        const version = versions[item.turnaroundId];
        const status = version?.status ?? 'loading';
        const unavailable = status === 'error' || status === 'forbidden';
        const shown = status !== 'loading' && !unavailable;
        const current = version?.detail?.turnaround ?? null;
        const correctable = Boolean(item.arrivedAt) && !recordable(item) &&
          (version?.detail?.allowedActions ?? []).includes('correctArrival');
        const flightReady = ready(item.turnaroundId);
        return (
          <div key={item.turnaroundId} className="space-y-2 border-b border-occ-line pb-3 last:border-0">
            <p><strong>{item.arrivalFlightNumber ?? item.operationCode}</strong>{' '}<span className="text-occ-muted">{item.airlineName}</span>
              {/* ADR-0041: a demo flight the superadministrator triggered is always labelled as such. */}
              {item.isDemo === true && <>{' '}<DemoTag /></>}
              <span className="block text-occ-muted">
                {t('actions.scheduledArrival', { time: formatTime(item.arrivalScheduledAt, zone) })}{', '}
                {item.arrivedAt ? t('actions.arrivedAt', { time: formatTime(item.arrivedAt, zone) }) : t('actions.notArrived')}
              </span></p>
            <VersionNotice version={version} onRetry={reload} />
            {shown && recordable(item) &&
              <ArrivalForm item={item} correcting={false} zone={zone} station={station} catalog={catalog} current={current}
                busy={busy} ready={flightReady} onSubmit={value => void arrival(item, value, false)} />}
            {shown && correctable && correcting !== item.turnaroundId &&
              <button type="button" className={buttonClass} disabled={Boolean(busy) || !flightReady}
                onClick={() => { setCorrecting(item.turnaroundId); setMessage({ tone: '', text: '' }); }}>
                {t('actions.correctArrival')}</button>}
            {shown && correctable && correcting === item.turnaroundId &&
              <ArrivalForm item={item} correcting zone={zone} station={station} catalog={catalog} current={current} busy={busy}
                ready={flightReady} onSubmit={value => void arrival(item, value, true)} onCancel={() => setCorrecting('')} />}
            {!unavailable && <button type="button" className={buttonClass} disabled={Boolean(busy) || !flightReady}
              onClick={() => void run(`release:${item.turnaroundId}`, { turnaroundId: item.turnaroundId }, item.turnaroundId,
                headers => releaseOccStand(item.turnaroundId, headers), t('actions.released', { position: position.id }))}>
              {busy === `release:${item.turnaroundId}` ? t('actions.releasing') : t('actions.release')}</button>}
          </div>
        );
      })}
      {movable.length > 0 && (
        <form className="space-y-2" noValidate onSubmit={event => {
          event.preventDefault();
          if (!turnaroundId) { setMessage({ tone: 'danger', text: t('actions.chooseFlight') }); return; }
          void run(`assign:${turnaroundId}`, { turnaroundId, standId: position.standId }, turnaroundId,
            headers => assignOccStand(turnaroundId, position.standId, null, headers), t('actions.assigned', { position: position.id }))
            .then(done => { if (done) setTurnaroundId(''); });
        }}>
          <label className={LABEL}>{t('actions.assignLabel', { position: position.id })}
            <select className={`mt-1 ${selectClass}`} value={turnaroundId} onChange={event => setTurnaroundId(event.target.value)}>
              <option value="">{t('actions.selectFlight')}</option>
              {movable.map(item => <option key={item.turnaroundId} value={item.turnaroundId}>
                {(item.arrivalFlightNumber ?? item.operationCode)} · {item.airlineName}{item.isDemo === true ? ' · Demo' : ''}
                {' · '}{formatTime(item.arrivalScheduledAt, zone)}
                {item.standCode ? ` ${t('actions.nowAt', { stand: item.standCode })}` : ''}</option>)}
            </select></label>
          {turnaroundId && <VersionNotice version={selected} onRetry={reload} />}
          <button type="submit" className={buttonClass} disabled={Boolean(busy) || (Boolean(turnaroundId) && !ready(turnaroundId))}>
            {busy === `assign:${turnaroundId}` ? t('actions.assigning') : t('actions.assign')}</button>
        </form>
      )}
      {message.text && <p role={message.tone === 'danger' ? 'alert' : 'status'}
        className={message.tone === 'danger' ? 'text-occ-danger' : 'text-occ-text'}>{message.text}</p>}
    </section>
  );
}
