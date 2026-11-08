import { useEffect, useRef, useState } from 'react';
import { IATA_DELAY_CODES, OCC_INCIDENT_SEVERITIES, OCC_INCIDENT_TYPES } from '@elevant/api-client';
import { useTranslation } from '../../i18n/LanguageScope';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { stationLocalToUtc, utcToStationLocalInput } from '../../services/businessDay';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { changeOccIncidentStatus, loadOccIncidents, reportOccIncident } from '../../services/occIncidentsService';
import {
  incidentSeverityLabel, incidentStatusLabel, incidentTypeLabel, operationStatusLabel,
} from '../operations/operationLabels';
import { incidentMessages } from './incidentMessages';

const READ = 'operations.incidents.read';
const MANAGE = 'operations.incidents.update';
const FIELD = 'mt-1 block w-full rounded-lg border border-black/20 bg-white p-2 text-ink-900';

function dateTime(value, timeZone, locale) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value));
  } catch {
    return value;
  }
}

const validNote = value => value.trim().length >= 8 && value.trim().length <= 2000;
const emptyReport = timeZone => ({
  incidentType: '', severity: '', description: '', delayCode: '',
  occurredAt: utcToStationLocalInput(new Date(), timeZone),
});

function IncidentRow({ incident, timeZone, canManage, editing, busy, onEdit, onCancel, onConfirm }) {
  const { t, locale, language } = useTranslation(incidentMessages);
  const [note, setNote] = useState('');
  const target = editing?.incidentId === incident.id ? editing.status : null;
  const actionLabel = status => (status === 'InReview' && incident.status === 'Resolved'
    ? t('actions.Reopen') : t(`actions.${status}`));

  return (
    <li className="space-y-1 py-3">
      <p>
        <strong>{incidentTypeLabel(incident.type, language)} · {incidentSeverityLabel(incident.severity, language)}</strong>
        {' · '}{incidentStatusLabel(incident.status, language)}
        {incident.delayCode && <span className="ml-2 rounded bg-status-warning/15 px-1.5 py-0.5 text-xs font-semibold">IATA {incident.delayCode}</span>}
        <span className="ml-2 text-xs text-text-secondary-light">{dateTime(incident.occurredAt, timeZone, locale)}</span>
      </p>
      <p className="text-sm">{incident.description}</p>
      <p className="text-xs text-text-secondary-light">
        {t('reportedBy', { name: incident.reportedBy, kind: t(`kind.${incident.reportedByKind}`),
          date: dateTime(incident.reportedAt, timeZone, locale) })}
      </p>
      {incident.resolutionNote && <p className="text-xs">{t('resolution', { note: incident.resolutionNote })}</p>}
      {incident.resolvedBy && incident.resolvedAt && (
        <p className="text-xs">{t('resolvedBy', { name: incident.resolvedBy, date: dateTime(incident.resolvedAt, timeZone, locale) })}</p>
      )}
      {incident.history.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer">{t('history', { count: incident.history.length })}</summary>
          <ol className="mt-1 space-y-1">
            {incident.history.map(event => (
              <li key={`${event.occurredAt}:${event.toStatus}:${event.actor}`}>
                {t('historyStep', {
                  date: dateTime(event.occurredAt, timeZone, locale), actor: event.actor,
                  from: event.fromStatus ? `${incidentStatusLabel(event.fromStatus, language)} → ` : `${t('reported')} → `,
                  to: incidentStatusLabel(event.toStatus, language), note: event.note,
                })}
              </li>
            ))}
          </ol>
        </details>
      )}
      {canManage && !target && incident.allowedStatuses.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {incident.allowedStatuses.map(status => (
            <button key={status} type="button" disabled={busy} onClick={() => { setNote(''); onEdit(incident.id, status); }}
              className="min-h-10 rounded-lg border border-accent-600 px-3 py-1.5 text-xs font-semibold text-accent-600 disabled:opacity-50">
              {actionLabel(status)}
            </button>
          ))}
        </div>
      )}
      {target && (
        <form className="space-y-2 rounded-lg border border-status-warning/40 p-3 text-sm"
          aria-label={actionLabel(target)}
          onSubmit={event => { event.preventDefault(); if (validNote(note)) onConfirm(incident, target, note.trim()); }}>
          <p className="font-semibold">{actionLabel(target)}</p>
          <label className="block">{t('note')}
            <textarea required minLength={8} maxLength={2000} rows={2} value={note}
              onChange={event => setNote(event.target.value)} className={FIELD} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !validNote(note)}
              className="min-h-10 rounded-lg bg-accent-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              {busy ? t('saving') : t('confirm')}
            </button>
            <button type="button" disabled={busy} onClick={onCancel} className="min-h-10 rounded-lg border px-3 py-1.5">{t('cancel')}</button>
          </div>
        </form>
      )}
    </li>
  );
}

function ReportForm({ operationId, timeZone, onReported, onCancel, onConflict }) {
  const { t, language } = useTranslation(incidentMessages);
  const keys = useRef(createCommandKeyHolder());
  const [form, setForm] = useState(() => emptyReport(timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deviation = form.incidentType === 'Deviation';
  const set = (field, value) => setForm(current => ({ ...current, [field]: value }));
  const complete = form.incidentType && form.severity && form.occurredAt && validNote(form.description) &&
    (!deviation || form.delayCode);

  async function submit(event) {
    event.preventDefault();
    if (busy || !complete) return;
    const command = {
      incidentType: form.incidentType, severity: form.severity, description: form.description.trim(),
      occurredAt: stationLocalToUtc(form.occurredAt, timeZone), delayCode: deviation ? form.delayCode : null,
    };
    setBusy(true);
    setError('');
    try {
      await keys.current.run('report', { operationId, ...command }, key => reportOccIncident(operationId, command, key));
      onReported();
    } catch (failure) {
      if (isAbortError(failure)) return;
      if (failure?.status === 409 || failure?.status === 412) onConflict(failure.message);
      else setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={event => void submit(event)} aria-label={t('report.title')}
      className="space-y-2 rounded-lg border border-accent-600/30 p-3 text-sm">
      <p className="font-semibold">{t('report.title')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">{t('report.type')}
          <select required value={form.incidentType} onChange={event => set('incidentType', event.target.value)} className={FIELD}>
            <option value="">{t('report.select')}</option>
            {OCC_INCIDENT_TYPES.map(type => <option key={type} value={type}>{incidentTypeLabel(type, language)}</option>)}
          </select>
        </label>
        <label className="block">{t('report.severity')}
          <select required value={form.severity} onChange={event => set('severity', event.target.value)} className={FIELD}>
            <option value="">{t('report.select')}</option>
            {OCC_INCIDENT_SEVERITIES.map(severity => (
              <option key={severity} value={severity}>{incidentSeverityLabel(severity, language)}</option>
            ))}
          </select>
        </label>
        <label className="block">{t('report.occurredAt')}
          <input type="datetime-local" required value={form.occurredAt}
            onChange={event => set('occurredAt', event.target.value)} className={FIELD} />
        </label>
        {deviation && (
          <label className="block">{t('report.delayCode')}
            <select required value={form.delayCode} onChange={event => set('delayCode', event.target.value)} className={FIELD}>
              <option value="">{t('report.select')}</option>
              {IATA_DELAY_CODES.map(item => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="block">{t('report.description')}
        <textarea required minLength={8} maxLength={2000} rows={3} value={form.description}
          onChange={event => set('description', event.target.value)} className={FIELD} />
      </label>
      {error && <p role="alert" className="text-status-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !complete}
          className="min-h-10 rounded-lg bg-accent-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
          {busy ? t('report.submitting') : t('report.submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-10 rounded-lg border px-3 py-1.5">
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function IncidentsPanel({ operationId, refreshToken, canManage }) {
  const { t, language } = useTranslation(incidentMessages);
  const keys = useRef(createCommandKeyHolder());
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [reads, setReads] = useState(0);
  const [editing, setEditing] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // A read after an own command or an `occ_review` announcement keeps the list on screen until the answer arrives;
  // only a read that never succeeded, or a refused access, replaces it.
  useEffect(() => {
    const controller = new AbortController();
    loadOccIncidents(operationId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ status: 'success', data, error: null }); })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState(current => (current.status === 'success' && error?.status !== 403 && error?.status !== 404
          ? current : { status: error?.status === 403 ? 'forbidden' : 'error', data: null, error }));
      });
    return () => abortForEffectCleanup(controller);
  }, [operationId, reads, refreshToken]);

  const reread = () => setReads(value => value + 1);
  const conflict = text => {
    setEditing(null);
    setReporting(false);
    setMessage({ kind: 'error', text });
    reread();
  };

  async function confirmChange(incident, status, note) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await keys.current.run('status', { incidentId: incident.id, status, note, version: incident.version },
        key => changeOccIncidentStatus(incident.id, { status, note }, incident.version, key));
      setEditing(null);
      setMessage({ kind: 'success', text: t('changed') });
      reread();
    } catch (failure) {
      if (isAbortError(failure)) return;
      if (failure?.status === 409 || failure?.status === 412) conflict(failure.message);
      else setMessage({ kind: 'error', text: failure.message });
    } finally {
      setBusy(false);
    }
  }

  const reported = () => {
    setReporting(false);
    setMessage({ kind: 'success', text: t('report.done') });
    reread();
  };

  const data = state.data;
  const timeZone = data?.ianaTimeZone ?? 'UTC';

  return (
    <section aria-label={t('title')} className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{t('title')}</h3>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {data ? `${data.operationCode} · ${operationStatusLabel(data.operationStatus, language)} · ` : ''}{t('intro')}
          </p>
        </div>
        {state.status === 'success' && canManage && data.canReport && !reporting && (
          <button type="button" disabled={busy} onClick={() => { setMessage(null); setReporting(true); }}
            className="min-h-10 rounded-lg border border-accent-600 px-3 py-1.5 text-sm font-semibold text-accent-600 disabled:opacity-50">
            {t('report.open')}
          </button>
        )}
      </div>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className="rounded-lg bg-accent-600/10 px-3 py-2 text-sm">{message.text}</p>}
      {state.status === 'loading' && <p role="status" className="text-sm">{t('loading')}</p>}
      {state.status === 'forbidden' && <p role="alert" className="text-sm">{t('forbidden')}</p>}
      {state.status === 'error' && (
        <div role="alert" className="space-y-2 text-sm">
          <p className="font-semibold">{t('error')}</p>
          <p>{state.error?.message}</p>
          <button type="button" onClick={() => { setState({ status: 'loading', data: null, error: null }); reread(); }}
            className="min-h-10 rounded-lg bg-accent-600 px-3 py-1.5 font-semibold text-white">{t('retry')}</button>
        </div>
      )}
      {state.status === 'success' && <>
        {canManage && !data.canReport && <p className="text-xs text-text-secondary-light">{t('report.closed')}</p>}
        {reporting && <ReportForm operationId={operationId} timeZone={timeZone} onReported={reported}
          onCancel={() => setReporting(false)} onConflict={conflict} />}
        {data.incidents.length === 0 ? <p className="text-sm">{t('empty')}</p> : (
          <ul className="divide-y divide-black/10 dark:divide-white/10">
            {data.incidents.map(incident => (
              <IncidentRow key={incident.id} incident={incident} timeZone={timeZone} canManage={canManage}
                editing={editing} busy={busy} onEdit={(incidentId, status) => { setMessage(null); setEditing({ incidentId, status }); }}
                onCancel={() => setEditing(null)} onConfirm={(item, status, note) => void confirmChange(item, status, note)} />
            ))}
          </ul>
        )}
      </>}
    </section>
  );
}

/**
 * OCC's live incidents of one operation (3-G): what the agent and OCC reported, with their history; OCC moves each one
 * with a note and reports its own in the station's local time. `refreshToken` re-reads it when `occ_review` is announced.
 * Without `operations.incidents.read` the panel is not shown; the server still decides every read and change.
 */
export default function OperationIncidentsPanel({ operationId, refreshToken = 0 }) {
  const access = useOptionalDepartmentAccess();
  if (access && !access.can(READ)) return null;
  return <IncidentsPanel key={operationId} operationId={operationId} refreshToken={refreshToken}
    canManage={Boolean(access?.can(MANAGE))} />;
}
