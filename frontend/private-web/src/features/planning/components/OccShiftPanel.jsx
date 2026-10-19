import { useEffect, useRef, useState } from 'react';
import { programPlanningShift } from '../../../services/planningService';
import { OCC_SHIFT_PRESETS, getOccShiftPreset } from './occShiftPresets';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

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

export default function OccShiftPanel({ flight, optionsState, onProgrammed }) {
  const { t } = useTranslation(planningMessages);
  const [agentId, setAgentId] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [endsAtLocal, setEndsAtLocal] = useState('');
  const [presetId, setPresetId] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const controllerRef = useRef(null);

  useEffect(() => {
    setAgentId('');
    setStartsAtLocal(localClock(flight?.operation?.plannedStartAt,
      flight?.station?.ianaTimeZone));
    setEndsAtLocal(localClock(flight?.operation?.plannedEndAt,
      flight?.station?.ianaTimeZone));
    setPresetId('');
    setStatus('idle');
    setError('');
    return () => controllerRef.current?.abort();
  }, [flight?.turnaroundId]);

  if (!flight || flight.operation?.status !== 'Planned' ||
      !flight.stand?.terminal || optionsState.status !== 'success') return null;

  const candidates = (optionsState.data?.agents ?? []).filter(agent =>
    agent.eligible === false && agent.eligibilityReasons?.length === 1 &&
    agent.eligibilityReasons[0] === 'shift_not_compatible');
  if (!candidates.length) return null;

  async function submit(event) {
    event.preventDefault();
    if (!agentId || !startsAtLocal || !endsAtLocal || status === 'submitting') return;
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
      onProgrammed?.();
    } catch (failure) {
      if (controller.signal.aborted || failure?.name === 'AbortError') return;
      setStatus('error');
      setError(failure?.status === 401 ? 'shift.sessionEnded' :
        failure?.status === 403 ? 'shift.forbidden' :
        failure?.status === 409 ? 'shift.conflict' :
        'shift.error');
    }
  }

  return (
    <form onSubmit={submit} aria-label={t('shift.formLabel')} className="space-y-3 rounded-xl border border-accent-600/20 bg-accent-600/[0.04] p-3">
      <div>
        <p className="text-xs font-semibold text-ink-900 dark:text-text-primary-dark">{t('shift.title')}</p>
        <p className="mt-1 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
          {t('shift.hint')}
        </p>
      </div>
      <label className="block text-xs font-medium">{t('shift.agent')}
        <select required value={agentId} onChange={event => setAgentId(event.target.value)}
          className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-surface-dark-card">
          <option value="">{t('shift.selectAgent')}</option>
          {candidates.map(agent => <option key={agent.id} value={agent.id}>{agent.displayName} · {agent.employeeNumber}</option>)}
        </select>
      </label>
      <label className="block text-xs font-medium">{t('shift.preset')}
        <select value={presetId} onChange={event => {
          const preset = getOccShiftPreset(event.target.value);
          setPresetId(preset?.id ?? '');
          if (preset) {
            setStartsAtLocal(preset.startsAtLocal);
            setEndsAtLocal(preset.endsAtLocal);
          }
        }} className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-surface-dark-card">
          <option value="">{t('shift.custom')}</option>
          {OCC_SHIFT_PRESETS.map(preset =>
            <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        <label className="block text-xs font-medium">{t('shift.start')}
          <input required type="time" step="60" value={startsAtLocal}
            onChange={event => { setStartsAtLocal(event.target.value); setPresetId(''); }}
            className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-surface-dark-card" />
        </label>
        <label className="block text-xs font-medium">{t('shift.end')}
          <input required type="time" step="60" value={endsAtLocal}
            onChange={event => { setEndsAtLocal(event.target.value); setPresetId(''); }}
            className="mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-surface-dark-card" />
        </label>
      </div>
      {startsAtLocal && endsAtLocal && startsAtLocal > endsAtLocal && <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{t('shift.overnight')}</p>}
      {error && <p role="alert" className="text-xs text-status-danger">{t(error)}</p>}
      <button type="submit" disabled={status === 'submitting' || !agentId || !startsAtLocal || !endsAtLocal}
        className="rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {status === 'submitting' ? t('shift.submitting') : t('shift.submit')}
      </button>
    </form>
  );
}
