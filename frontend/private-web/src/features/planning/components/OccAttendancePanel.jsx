import { useEffect, useRef, useState } from 'react';
import { useAttendanceDraft } from '../attendance/useAttendanceDraft';

const EMPTY_FIELDS = { start: '', end: '', note: '' };

function localInputValue(instant) {
  if (!instant) return '';
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
}

function formatRecorded(instant) {
  if (!instant) return 'Sin registrar';
  const date = new Date(instant);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Sin registrar';
}

export default function OccAttendancePanel({ operationId, assignmentId, displayName }) {
  const { status, snapshot, attempted, conflict, pending, error,
    save, reload, retryPending } = useAttendanceDraft({ operationId, assignmentId,
    enabled: Boolean(operationId && assignmentId) });
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [validation, setValidation] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingConflict, setEditingConflict] = useState(false);
  const loadedRevision = useRef(null);
  const dirtyRef = useRef(false);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'zona local del dispositivo';

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
    const start = fields.start ? new Date(fields.start) : null;
    const end = fields.end ? new Date(fields.end) : null;
    if ((start && !Number.isFinite(start.getTime())) ||
      (end && !Number.isFinite(end.getTime())) ||
      (start && end && end < start)) {
      setValidation('Revisa las horas: la salida no puede ser anterior a la entrada.');
      return;
    }
    const note = fields.note.trim();
    if ((!start && !end && !note) || note.length > 2_000) {
      setValidation('Registra una hora o una nota de hasta 2000 caracteres.');
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
    return <p role="status">Cargando asistencia de {displayName}…</p>;
  }
  if (status === 'forbidden' || status === 'unauthorized' ||
    (status === 'error' && !snapshot)) {
    return <div role="alert" className="space-y-2 text-sm text-rose-700 dark:text-rose-300">
      <p>{error?.message ?? 'No fue posible consultar la asistencia.'}</p>
      {error?.recoverable && <button type="button" onClick={() => reload()}
        className="min-h-11 rounded-lg border px-3 focus-visible:ring-2">Reintentar lectura</button>}
    </div>;
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div>
        <h4 className="text-sm font-semibold">Asistencia de {displayName}</h4>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          Observación manual. Horas editadas en {timeZone}; no es fichaje biométrico.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-surface-dark-card">
        <h5 className="text-xs font-semibold uppercase tracking-wide">Aporte del agente</h5>
        {snapshot?.rampAgent ? <div className="mt-1 text-xs">
          <p>{snapshot.rampAgent.incidentNote || 'Sin nota'}</p>
          <p>Entrada: {formatRecorded(snapshot.rampAgent.observedStartAt)} · Salida: {formatRecorded(snapshot.rampAgent.observedEndAt)}</p>
          <p>Guardado: {formatRecorded(snapshot.rampAgent.recordedAt)}</p>
        </div> : <p className="mt-1 text-xs">Aún no hay aporte del agente.</p>}
      </div>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs">Versión guardada: {snapshot?.occ?.revision ?? 0}</p>
        {(conflict || editingConflict) && <div role="alert" className="rounded-lg border border-amber-400 p-2 text-xs">
          El aporte de OCC cambió. Tu intento sigue aquí; compara la versión guardada y decide si deseas guardar otra vez.
          <p>Nota guardada: {snapshot?.occ?.incidentNote || 'Sin nota'}</p>
        </div>}
        {pending && <p role="status" className="text-xs">Pendiente de confirmar. Reintenta la misma intención antes de editar.</p>}
        {error && !conflict && !pending && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error.message}</p>}
        {validation && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{validation}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">Entrada observada
            <input type="datetime-local" value={fields.start} disabled={saving || pending}
              onChange={event => { dirtyRef.current = true; setFields(previous => ({ ...previous, start: event.target.value })); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:bg-surface-dark-card" />
          </label>
          <label className="text-xs">Salida observada
            <input type="datetime-local" value={fields.end} disabled={saving || pending}
              onChange={event => { dirtyRef.current = true; setFields(previous => ({ ...previous, end: event.target.value })); }}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs dark:bg-surface-dark-card" />
          </label>
        </div>
        <label className="block text-xs">Nota de OCC
          <textarea value={fields.note} maxLength={2000} disabled={saving || pending}
            onChange={event => { dirtyRef.current = true; setFields(previous => ({ ...previous, note: event.target.value })); }}
            className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:bg-surface-dark-card" />
        </label>
        <div className="flex flex-wrap gap-2">
          {pending ? <button type="button" onClick={() => void retryPending()} disabled={saving}
            className="min-h-11 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white focus-visible:ring-2">
            Reintentar misma intención</button> : <button type="submit" disabled={saving || !snapshot}
            className="min-h-11 rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white focus-visible:ring-2 disabled:opacity-50">
            {conflict || editingConflict ? 'Guardar con versión actual' : 'Guardar observación OCC'}</button>}
          <button type="button" onClick={() => void reload()} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs focus-visible:ring-2">Actualizar aportes</button>
        </div>
      </form>
    </div>
  );
}
