import { useEffect, useRef, useState } from 'react';
import { getOccAgentShift, programPlanningShift } from '../../../services/planningService';
import { adjustHumanResourcesShift } from '../../../services/humanResourcesShiftsReadService';
import { utcToStationLocalInput } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { problemMessage } from '../../../services/problemMessages';
import { OCC_SHIFT_PRESETS, getOccShiftPreset } from './occShiftPresets';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages, SHIFT_PROBLEM_MESSAGES } from '../planningMessages';

function localClock(instant, timeZone) {
  if (!instant || !timeZone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instant));
    const hour = parts.find(part => part.type === 'hour')?.value;
    const minute = parts.find(part => part.type === 'minute')?.value;
    return hour && minute ? `${hour}:${minute}` : '';
  } catch {
    return '';
  }
}

const MINUTES_PER_DAY = 1440;
const MAX_SHIFT_MINUTES = 16 * 60;
const minutesOf = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
const clockOf = minutes => {
  const value = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

/** Minutes of an instant from the start of `workDate` in the station's calendar, or null when it is unknown. */
function minutesFrom(workDate, instant, timeZone) {
  const local = utcToStationLocalInput(instant, timeZone);
  if (!local || !/^\d{4}-\d{2}-\d{2}$/.test(workDate ?? '')) return null;
  const days = (Date.parse(`${local.slice(0, 10)}T00:00:00Z`) - Date.parse(`${workDate}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) ? days * MINUTES_PER_DAY + minutesOf(local.slice(11, 16)) : null;
}

/**
 * The hours «Ajustar turno del día» proposes (3-E): the agent's shift widened to cover the flight, so it keeps covering
 * what the shift already holds (the server checks it: `shift_uncovers_work`). When that would exceed sixteen hours, or
 * the flight's window is unknown, it proposes the flight's window; the agent's shift otherwise.
 */
function coveringHours(shift, flight) {
  const timeZone = flight?.station?.ianaTimeZone;
  const start = minutesOf(shift.startsAtLocal);
  const end = minutesOf(shift.endsAtLocal) + (minutesOf(shift.endsAtLocal) <= start ? MINUTES_PER_DAY : 0);
  const from = minutesFrom(shift.workDate, flight?.operation?.plannedStartAt, timeZone);
  const until = minutesFrom(shift.workDate, flight?.operation?.plannedEndAt, timeZone);
  if (from === null || until === null || until <= from) return { start: clockOf(start), end: clockOf(end) };
  const wideStart = Math.min(start, from);
  const wideEnd = Math.max(end, until);
  if (wideStart >= 0 && wideStart < MINUTES_PER_DAY && wideEnd - wideStart <= MAX_SHIFT_MINUTES)
    return { start: clockOf(wideStart), end: clockOf(wideEnd) };
  return { start: clockOf(from), end: clockOf(until) };
}

const IDLE_SHIFT = Object.freeze({ status: 'idle', shift: null });
const LOADING_SHIFT = Object.freeze({ status: 'loading', shift: null });

/**
 * «Programar turno» for the agents who meet every other rule but have no shift that covers the flight (ADR-0026).
 * Choosing an agent reads the shift they already have that day (3-E): without one the panel programs it; with one it
 * becomes «Ajustar turno del día», which widens that same shift with a reason, its version and the intent's key
 * (`adjustHumanResourcesShift`, shared with Gestión Humana). A conflict reads the agent's shift or the options again
 * before a new intent.
 */
export default function OccShiftPanel({ flight, optionsState, onProgrammed, onStale }) {
  const { t } = useTranslation(planningMessages);
  const [agentId, setAgentId] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [endsAtLocal, setEndsAtLocal] = useState('');
  const [presetId, setPresetId] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  // The answer of one read of the chosen agent's shift (the flight, the agent and the attempt it belongs to).
  const [shiftAnswer, setShiftAnswer] = useState(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const controllerRef = useRef(null);
  const adjustment = useRef(createCommandKeyHolder());
  const turnaroundId = flight?.turnaroundId;
  const plannedStartAt = flight?.operation?.plannedStartAt;
  const plannedEndAt = flight?.operation?.plannedEndAt;
  const timeZone = flight?.station?.ianaTimeZone;
  // The latest flight, for the hours proposed when a shift read in flight arrives.
  const flightRef = useRef(flight);
  useEffect(() => { flightRef.current = flight; });

  useEffect(() => {
    setAgentId('');
    setStartsAtLocal(localClock(plannedStartAt, timeZone));
    setEndsAtLocal(localClock(plannedEndAt, timeZone));
    setPresetId('');
    setReason('');
    setStatus('idle');
    setError('');
    return () => controllerRef.current?.abort();
    // Only another flight resets the form; a new read of the same flight keeps what OCC typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnaroundId]);

  // 3-E: the shift the chosen agent already has that day decides between programming and adjusting.
  const shiftRequest = agentId && turnaroundId ? `${turnaroundId}:${agentId}:${readAttempt}` : null;
  useEffect(() => {
    if (!shiftRequest) return undefined;
    const controller = new AbortController();
    getOccAgentShift(turnaroundId, agentId, { signal: controller.signal })
      .then(shift => {
        if (controller.signal.aborted) return;
        setShiftAnswer({ request: shiftRequest, status: 'found', shift });
        const proposed = coveringHours(shift, flightRef.current);
        setStartsAtLocal(proposed.start);
        setEndsAtLocal(proposed.end);
        setPresetId('');
      })
      .catch(failure => {
        if (controller.signal.aborted || failure?.name === 'AbortError') return;
        // No shift that day (`shift_not_found`): the agent's shift is programmed, as before.
        setShiftAnswer({ request: shiftRequest, status: failure?.status === 404 ? 'none'
          : failure?.status === 403 ? 'forbidden' : failure?.status === 401 ? 'unauthorized' : 'error', shift: null });
      });
    return () => controller.abort();
  }, [agentId, turnaroundId, shiftRequest]);
  const agentShift = !shiftRequest ? IDLE_SHIFT : shiftAnswer?.request === shiftRequest ? shiftAnswer : LOADING_SHIFT;

  if (!flight || flight.operation?.status !== 'Planned' ||
      !flight.stand?.terminal || optionsState.status !== 'success') return null;

  const candidates = (optionsState.data?.agents ?? []).filter(agent =>
    agent.eligible === false && agent.eligibilityReasons?.length === 1 &&
    agent.eligibilityReasons[0] === 'shift_not_compatible');
  if (!candidates.length) return null;

  const shift = agentShift.status === 'found' ? agentShift.shift : null;
  const otherTerminal = shift && flight.stand.terminal.code && shift.terminalCode !== flight.stand.terminal.code;
  const trimmedReason = reason.trim();
  const blocked = agentShift.status === 'error' || agentShift.status === 'forbidden' ||
    agentShift.status === 'unauthorized';

  async function program() {
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus('submitting');
    setError('');
    try {
      await programPlanningShift(flight.turnaroundId, {
        agentId, startsAtLocal: `${startsAtLocal}:00`, endsAtLocal: `${endsAtLocal}:00`,
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setStatus('success');
      onProgrammed?.('programmed');
    } catch (failure) {
      if (controller.signal.aborted || failure?.name === 'AbortError') return;
      setStatus('error');
      // 3-E: the agent already has a shift that day: it is read again to be adjusted, never doubled.
      if (failure?.status === 409 && failure?.problemCode === 'shift_day_taken') {
        setError(t('shift.dayTaken'));
        setReadAttempt(value => value + 1);
        return;
      }
      setError(t(failure?.status === 401 ? 'shift.sessionEnded' :
        failure?.status === 403 ? 'shift.forbidden' :
        failure?.status === 409 ? 'shift.conflict' :
        'shift.error'));
      // The flight, the agent or their scope changed: the options are read again before a new intent.
      if (failure?.status === 409) onStale?.();
    }
  }

  async function adjust() {
    const command = { startsAtLocal: `${startsAtLocal}:00`, endsAtLocal: `${endsAtLocal}:00`, reason: trimmedReason,
      expectedVersion: shift.version };
    setStatus('submitting');
    setError('');
    try {
      // One intent per shift and body: an uncertain answer repeats the same key, so the shift is adjusted once.
      await adjustment.current.run('adjust', [shift.shiftId, command],
        key => adjustHumanResourcesShift(shift.shiftId, command, key));
      setStatus('success');
      setReason('');
      onProgrammed?.('adjusted');
    } catch (failure) {
      if (failure?.name === 'AbortError') return;
      setStatus('error');
      setError(failure instanceof TypeError ? SHIFT_PROBLEM_MESSAGES.invalid_shift
        : problemMessage(failure, SHIFT_PROBLEM_MESSAGES, { forbidden: t('shift.forbidden'), fallback: t('shift.error') }));
      // Another version of the shift, or no shift any more: it is read again; a broken rule keeps the form as it is.
      if (failure?.status === 404 || (failure?.status === 409 &&
          (failure.code === 'version_conflict' || failure.code === 'idempotency_conflict'))) {
        setReadAttempt(value => value + 1);
      }
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!agentId || !startsAtLocal || !endsAtLocal || status === 'submitting' || blocked) return;
    if (shift) {
      if (otherTerminal || trimmedReason.length < 5 || trimmedReason.length > 500) return;
      void adjust();
    } else {
      void program();
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-surface-dark-card';
  const canSubmit = Boolean(agentId && startsAtLocal && endsAtLocal) && status !== 'submitting' && !blocked &&
    (!shift || (!otherTerminal && trimmedReason.length >= 5 && trimmedReason.length <= 500));
  return (
    <form onSubmit={submit} aria-label={shift ? t('shift.adjustTitle') : t('shift.formLabel')} className="space-y-3 rounded-xl border border-accent-600/20 bg-accent-600/[0.04] p-3">
      <div>
        <p className="text-xs font-semibold text-ink-900 dark:text-text-primary-dark">
          {shift ? t('shift.adjustTitle') : t('shift.title')}</p>
        <p className="mt-1 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
          {shift ? t('shift.adjustHint') : t('shift.hint')}
        </p>
      </div>
      <label className="block text-xs font-medium">{t('shift.agent')}
        <select required value={agentId} onChange={event => { setAgentId(event.target.value); setError(''); }}
          className={field}>
          <option value="">{t('shift.selectAgent')}</option>
          {candidates.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName} · {agent.employeeNumber}</option>)}
        </select>
      </label>
      {agentShift.status === 'loading' && <p role="status" className="text-xs">{t('shift.loadingShift')}</p>}
      {agentShift.status === 'error' && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-status-danger">{t('shift.shiftReadError')}</span>
        <button type="button" onClick={() => setReadAttempt(value => value + 1)}
          className="min-h-11 rounded-lg border border-accent-600/40 px-3 font-semibold text-accent-600">{t('shift.retryShift')}</button>
      </div>}
      {agentShift.status === 'forbidden' && <p role="alert" className="text-xs text-status-danger">{t('shift.forbidden')}</p>}
      {agentShift.status === 'unauthorized' && <p role="alert" className="text-xs text-status-danger">{t('shift.sessionEnded')}</p>}
      {shift && <p className="text-xs">{t('shift.current', { start: shift.startsAtLocal.slice(0, 5),
        end: shift.endsAtLocal.slice(0, 5), terminal: shift.terminalCode })}</p>}
      {otherTerminal && <p role="status" className="text-xs font-semibold text-status-warning">
        {t('shift.otherTerminal', { shift: shift.terminalCode, flight: flight.stand.terminal.code })}</p>}
      {!blocked && <>
        {!shift && <label className="block text-xs font-medium">{t('shift.preset')}
          <select value={presetId} onChange={event => {
            const preset = getOccShiftPreset(event.target.value);
            setPresetId(preset?.id ?? '');
            if (preset) {
              setStartsAtLocal(preset.startsAtLocal);
              setEndsAtLocal(preset.endsAtLocal);
            }
          }} className={field}>
            <option value="">{t('shift.custom')}</option>
            {OCC_SHIFT_PRESETS.map(preset =>
              <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </label>}
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          <label className="block text-xs font-medium">{t('shift.start')}
            <input required type="time" step="60" value={startsAtLocal}
              onChange={event => { setStartsAtLocal(event.target.value); setPresetId(''); }}
              className={field} />
          </label>
          <label className="block text-xs font-medium">{t('shift.end')}
            <input required type="time" step="60" value={endsAtLocal}
              onChange={event => { setEndsAtLocal(event.target.value); setPresetId(''); }}
              className={field} />
          </label>
        </div>
        {startsAtLocal && endsAtLocal && startsAtLocal > endsAtLocal && <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('shift.overnight')}</p>}
        {shift && <>
          <label className="block text-xs font-medium">{t('shift.reason')}
            <textarea value={reason} maxLength={500} rows={2} onChange={event => setReason(event.target.value)}
              className={`${field} py-2`} />
          </label>
          <p className="text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{t('shift.reasonHint')}</p>
        </>}
      </>}
      {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
      {!blocked && <button type="submit" disabled={!canSubmit}
        className="rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {shift
          ? (status === 'submitting' ? t('shift.adjustSubmitting') : t('shift.adjustSubmit'))
          : (status === 'submitting' ? t('shift.submitting') : t('shift.submit'))}
      </button>}
    </form>
  );
}
