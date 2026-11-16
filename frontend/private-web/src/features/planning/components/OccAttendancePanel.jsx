import { useEffect, useRef, useState } from 'react';
import { useAttendanceDraft } from '../attendance/useAttendanceDraft';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

const EMPTY_FIELDS = { start: '', end: '', note: '' };

function localInputValue(instant) {
  if (!instant) return '';
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
}

function formatRecorded(instant, locale, notRecorded) {
  if (!instant) return notRecorded;
  const date = new Date(instant);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale) : notRecorded;
}

export default function OccAttendancePanel({ operationId, assignmentId, displayName }) {
  const { t, locale } = useTranslation(planningMessages);
  const { status, snapshot, attempted, conflict, conflictReady, pending, error,
    save, reload, retryPending } = useAttendanceDraft({ operationId, assignmentId,
    enabled: Boolean(operationId && assignmentId) });
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [validation, setValidation] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingConflict, setEditingConflict] = useState(false);
  const loadedRevision = useRef(null);
  const dirtyRef = useRef(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || t('attendance.deviceZone');
  const notRecorded = t('attendance.notRecorded');
  const recorded = instant => formatRecorded(instant, locale, notRecorded);

  useEffect(() => {
    loadedRevision.current = null;
    dirtyRef.current = false;
    setFields(EMPTY_FIELDS);
    setValidation('');
    setEditingConflict(false);
  }, [operationId, assignmentId]);

  useEffect(() => {
    if (!snapshot || attempted || pending || conflict) return;
    const revision = snapshot.occ?.revision ?? 0;
    if (loadedRevision.current === revision) return;
    loadedRevision.current = revision;
    if (dirtyRef.current) {
      setEditingConflict(true);
      return;
    }
    setFields({
      start: localInputValue(snapshot.occ?.observedStartAt),
      end: localInputValue(snapshot.occ?.observedEndAt),
      note: snapshot.occ?.incidentNote ?? '',
    });
  }, [snapshot, attempted, pending, conflict]);

  async function submit(event) {
    event.preventDefault();
    if (status !== 'ready' || (conflict && !conflictReady)) return;
    const start = fields.start ? new Date(fields.start) : null;
    const end = fields.end ? new Date(fields.end) : null;
    if ((start && !Number.isFinite(start.getTime())) ||
      (end && !Number.isFinite(end.getTime())) ||
      (start && localInputValue(start.toISOString()) !== fields.start) ||
      (end && localInputValue(end.toISOString()) !== fields.end) ||
      (start && end && end < start)) {
      setValidation('attendance.invalidTimes');
      return;
    }
    const note = fields.note.trim();
    if ((!start && !end && !note) || note.length > 2_000) {
      setValidation('attendance.invalidNote');
      return;
    }
    setValidation('');
    setSaving(true);
    try {
      const receipt = await save({ observedStartAt: start?.toISOString() ?? null,
        observedEndAt: end?.toISOString() ?? null, incidentNote: note || null });
      if (receipt) {
        dirtyRef.current = false;
        setEditingConflict(false);
      }
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading' || status === 'idle') {
    return <p role="status">{t('attendance.loading', { name: displayName })}</p>;
  }
  if (status === 'forbidden' || status === 'unauthorized' ||
    (status === 'error' && !snapshot)) {
    return <div role="alert" className="space-y-2 text-sm text-rose-700 dark:text-rose-300">
      <p>{error?.message ?? t('attendance.loadError')}</p>
      {error?.recoverable && <button type="button" onClick={() => reload()}
        className="min-h-11 rounded-lg border px-3 focus-visible:ring-2">{t('attendance.retryRead')}</button>}
    </div>;
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div>
        <h4 className="text-sm font-semibold">{t('attendance.title', { name: displayName })}</h4>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {t('attendance.hint', { zone: timeZone })}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-surface-dark-card">
        <h5 className="text-xs font-semibold uppercase tracking-wide">{t('attendance.agentContribution')}</h5>
        {snapshot?.rampAgent ? <div className="mt-1 text-xs">
          <p>{snapshot.rampAgent.incidentNote || t('attendance.noNote')}</p>
          <p>{t('attendance.inOut', { start: recorded(snapshot.rampAgent.observedStartAt), end: recorded(snapshot.rampAgent.observedEndAt) })}</p>
          <p>{t('attendance.saved', { at: recorded(snapshot.rampAgent.recordedAt) })}</p>
        </div> : <p className="mt-1 text-xs">{t('attendance.noContribution')}</p>}
      </div>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs">{conflict && !conflictReady ? t('attendance.previousVersion') : t('attendance.savedVersion')}: {snapshot?.occ?.revision ?? 0}</p>
        {(conflict || editingConflict) && <div role="alert" className="rounded-lg border border-amber-400 p-2 text-xs">
          {t('attendance.conflict')}
          {conflict && !conflictReady ? <p>{t('attendance.refreshFirst')}</p> : <>
            <p>{t('attendance.savedStart', { value: recorded(snapshot?.occ?.observedStartAt) })}</p>
            <p>{t('attendance.savedEnd', { value: recorded(snapshot?.occ?.observedEndAt) })}</p>
            <p>{t('attendance.savedNote', { value: snapshot?.occ?.incidentNote || t('attendance.noNote') })}</p>
          </>}
          <p>{t('attendance.attemptStart', { value: fields.start || notRecorded })}</p>
          <p>{t('attendance.attemptEnd', { value: fields.end || notRecorded })}</p>
          <p>{t('attendance.attemptNote', { value: fields.note || t('attendance.noNote') })}</p>
        </div>}
        {pending && <p role="status" className="text-xs">{t('attendance.pending')}</p>}
        {error && !conflict && !pending && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error.message}</p>}
        {validation && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{t(validation)}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">{t('attendance.observedStart')}
            <input type="datetime-local" value={fields.start} disabled={saving || pending}
              onChange={event => { dirtyRef.current = true; setFields(previous => ({ ...previous, start: event.target.value })); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:bg-surface-dark-card" />
          </label>
          <label className="text-xs">{t('attendance.observedEnd')}
            <input type="datetime-local" value={fields.end} disabled={saving || pending}
              onChange={event => { dirtyRef.current = true; setFields(previous => ({ ...previous, end: event.target.value })); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:bg-surface-dark-card" />
          </label>
        </div>
        <label className="block text-xs">{t('attendance.occNote')}
          <textarea value={fields.note} maxLength={2000} disabled={saving || pending}
            onChange={event => { dirtyRef.current = true; setFields(previous => ({ ...previous, note: event.target.value })); }}
            className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:bg-surface-dark-card" />
        </label>
        <div className="flex flex-wrap gap-2">
          {pending ? <button type="button" onClick={() => void retryPending()} disabled={saving}
            className="min-h-11 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white focus-visible:ring-2">
            {t('attendance.retryPending')}</button> : <button type="submit" disabled={saving || !snapshot || status !== 'ready' || (conflict && !conflictReady)}
            className="min-h-11 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white focus-visible:ring-2 disabled:opacity-50">
            {conflict || editingConflict ? t('attendance.saveCurrent') : t('attendance.save')}</button>}
          <button type="button" onClick={() => void reload()} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs focus-visible:ring-2">{t('attendance.refresh')}</button>
        </div>
      </form>
    </div>
  );
}
