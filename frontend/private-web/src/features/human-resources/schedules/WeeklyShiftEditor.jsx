import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adjustHumanResourcesShift, getAllHumanResourcesShifts, getHumanResourcesShiftAssignmentOptions,
  listRampAgentReadiness, recordHumanResourcesShift, removeHumanResourcesShift,
} from '../../../services/humanResourcesShiftsReadService';
import { getApprovedAbsences } from '../../../services/humanResourcesAvailabilityService';
import { businessToday } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { HUMAN_RESOURCES_PROBLEMS } from '../../../services/humanResourcesProblems';
import { problemMessage } from '../../../services/problemMessages';
import { OCC_SHIFT_PRESETS } from '../../planning/components/occShiftPresets';
import { addDays, toDateKey } from './mappers';

const DAY = new Intl.DateTimeFormat('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
const BLOCK = { Morning: 'Mañana', Afternoon: 'Tarde', Night: 'Noche' };
const time = value => value.slice(0, 5);
// The API takes local times with seconds (HH:mm:ss); the OCC presets are HH:mm.
const withSeconds = value => (value.length === 5 ? `${value}:00` : value);

function problem(error) {
  if (error instanceof TypeError) return 'Revisa los datos del turno.';
  return problemMessage(error, HUMAN_RESOURCES_PROBLEMS, {
    forbidden: 'Tu acceso no permite programar turnos en esa estación.',
    fallback: 'No fue posible guardar el turno. Intenta de nuevo.',
  });
}

/** What «Ajustar horario» says besides the shared Gestión Humana codes (3-E). */
const ADJUSTMENT_PROBLEMS = Object.freeze({
  ...HUMAN_RESOURCES_PROBLEMS,
  shift_in_past: 'Los turnos de días pasados no se ajustan: quedan en el historial.',
  invalid_shift: 'Revisa las horas: no pueden coincidir y el turno dura como máximo 16 horas.',
  version_conflict: 'El turno cambió mientras lo editabas. Actualizamos la semana; revisa e intenta de nuevo.',
});

function adjustmentProblem(error) {
  if (error instanceof TypeError) {
    return 'Revisa las horas y el motivo: el turno dura como máximo 16 horas y el motivo tiene de 5 a 500 caracteres.';
  }
  return problemMessage(error, ADJUSTMENT_PROBLEMS, {
    forbidden: 'Tu acceso no permite ajustar turnos en esa estación.',
    fallback: 'No fue posible ajustar el turno. Intenta de nuevo: el mismo envío no lo ajusta dos veces.',
  });
}

/** The approved absence of an agent on a date, if any (both dates included). */
function absenceOn(absences, rampProfileId, date) {
  return absences?.find(item => item.rampProfileId === rampProfileId && item.startsOn <= date && date <= item.endsOn)
    ?? null;
}

/**
 * Weekly shift editor for Gestión Humana (ADR-0026): one row per ramp agent, one cell per day.
 * A cell takes a template (the same presets OCC uses) at a station and terminal of the agent,
 * or removes the shift if the day has not passed. «Copiar semana anterior» repeats last week's
 * shifts on the days that are still free, never on an approved absence (2-N24). «Today» is
 * AVIAM's business day, never the UTC one (2-N31). «Ajustar horario» changes the hours of a shift of
 * today or later with a reason, its version and the intent's key, as OCC does from planning (3-E):
 * it keeps covering the agent's coverages and operations, and a validated attendance freezes it.
 */
export default function WeeklyShiftEditor({ weekStart, revision = 0, onChanged }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const from = toDateKey(days[0]);
  const to = toDateKey(days[6]);
  const today = businessToday();
  const [state, setState] = useState({ status: 'loading' });
  const [localRevision, setLocalRevision] = useState(0);
  const [cell, setCell] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const removal = useRef(createCommandKeyHolder());
  const [adjusting, setAdjusting] = useState(null);
  const adjustment = useRef(createCommandKeyHolder());

  const load = useCallback(async signal => {
    const [agents, shifts, absences] = await Promise.all([listRampAgentReadiness(),
      getAllHumanResourcesShifts(from, to, { signal }),
      // Without access to the requests the editor still works: the server refuses a shift on an absence anyway.
      getApprovedAbsences(from, to, { signal }).catch(error => {
        if (error?.name === 'AbortError') throw error;
        return null;
      })]);
    return { agents, shifts, absences };
  }, [from, to]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    load(controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ status: 'success', ...data }); })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: error?.status === 401 ? 'unauthorized' : error?.status === 403 ? 'forbidden' : 'error' });
      });
    return () => controller.abort();
  }, [load, revision, localRevision]);

  async function openCell(agent, date) {
    setNotice('');
    setAdjusting(null);
    setCell({ agent, date, status: 'loading' });
    try {
      const options = await getHumanResourcesShiftAssignmentOptions({ rampProfileId: agent.rampProfileId, workDate: date });
      const station = options.stations[0];
      setCell({ agent, date, status: 'ready', stations: options.stations, stationId: station?.id ?? '',
        terminalId: station?.terminals[0]?.id ?? '', presetId: OCC_SHIFT_PRESETS[0].id });
    } catch (error) {
      setCell({ agent, date, status: 'error', message: problem(error) });
    }
  }

  async function saveCell(event) {
    event.preventDefault();
    const preset = OCC_SHIFT_PRESETS.find(item => item.id === cell.presetId);
    setBusy(true);
    try {
      await recordHumanResourcesShift(crypto.randomUUID(), { rampProfileId: cell.agent.rampProfileId,
        stationId: cell.stationId, terminalId: cell.terminalId, workDate: cell.date,
        startsAtLocal: withSeconds(preset.startsAtLocal), endsAtLocal: withSeconds(preset.endsAtLocal), notes: null });
      setCell(null);
      setNotice(`Turno ${preset.label} asignado a ${cell.agent.agentName} el ${cell.date}.`);
      onChanged?.();
    } catch (error) {
      setCell(current => ({ ...current, message: problem(error) }));
      if (error?.status === 409) setLocalRevision(value => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function remove(shift) {
    setBusy(true);
    setNotice('');
    try {
      // One intent per shift and version: an uncertain answer repeats the same key (2-N11).
      await removal.current.run('remove', [shift.id, shift.version], key =>
        removeHumanResourcesShift(shift.id, shift.version, key));
      setNotice(`Turno del ${shift.workDate} de ${shift.agentName} eliminado.`);
      onChanged?.();
    } catch (error) {
      setNotice(problem(error));
      // The shift changed, is past or is still worked: the week is read again.
      if (error?.status === 409 || error?.status === 404) setLocalRevision(value => value + 1);
    } finally {
      setBusy(false);
    }
  }

  function openAdjustment(shift) {
    setNotice('');
    setCell(null);
    setAdjusting({ shift, startsAtLocal: time(shift.startsAtLocal), endsAtLocal: time(shift.endsAtLocal), reason: '',
      message: '' });
  }

  async function saveAdjustment(event) {
    event.preventDefault();
    const { shift, startsAtLocal, endsAtLocal } = adjusting;
    const command = { startsAtLocal: withSeconds(startsAtLocal), endsAtLocal: withSeconds(endsAtLocal),
      reason: adjusting.reason.trim(), expectedVersion: shift.version };
    setBusy(true);
    try {
      // One intent per shift and body: an uncertain answer repeats the same key, so the shift is adjusted once.
      await adjustment.current.run('adjust', [shift.id, command], key =>
        adjustHumanResourcesShift(shift.id, command, key));
      setAdjusting(null);
      setNotice(`Horario del ${shift.workDate} de ${shift.agentName} ajustado a ${startsAtLocal}–${endsAtLocal}.`);
      onChanged?.();
    } catch (error) {
      // The shift changed or is gone: the week is read again and the form closes; a broken rule keeps the form.
      if (error?.status === 404 || (error?.status === 409 &&
          (error.code === 'version_conflict' || error.code === 'idempotency_conflict'))) {
        setAdjusting(null);
        setNotice(adjustmentProblem(error));
        setLocalRevision(value => value + 1);
      } else {
        setAdjusting(current => current && { ...current, message: adjustmentProblem(error) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyPreviousWeek() {
    setBusy(true);
    setNotice('');
    try {
      const previous = await getAllHumanResourcesShifts(toDateKey(addDays(days[0], -7)), toDateKey(addDays(days[0], -1)));
      const taken = new Set(state.shifts.map(item => `${item.rampProfileId}|${item.workDate}`));
      // An agent who left the ramp gets no new shift: skipped without asking the server.
      const activeAgents = new Set(state.agents.map(agent => agent.rampProfileId));
      let created = 0;
      let absent = 0;
      let occupied = 0;
      let other = 0;
      for (const shift of previous) {
        const date = toDateKey(addDays(new Date(`${shift.workDate}T12:00:00`), 7));
        if (date < today || taken.has(`${shift.rampProfileId}|${date}`)) { occupied++; continue; }
        if (absenceOn(state.absences, shift.rampProfileId, date)) { absent++; continue; }
        if (!activeAgents.has(shift.rampProfileId)) { other++; continue; }
        try {
          await recordHumanResourcesShift(crypto.randomUUID(), { rampProfileId: shift.rampProfileId, stationId: shift.stationId,
            terminalId: shift.terminalId, workDate: date, startsAtLocal: withSeconds(shift.startsAtLocal),
            endsAtLocal: withSeconds(shift.endsAtLocal), notes: null });
          created++;
        } catch (error) {
          if (error?.code === 'shift_on_approved_absence') absent++;
          else if (error?.code === 'shift_day_taken') occupied++;
          else other++;
        }
      }
      const skipped = absent + occupied + other;
      const details = [absent && `${absent} por ausencia aprobada`, occupied && `${occupied} por día ocupado o pasado`,
        other && `${other} sin acceso, sin alcance o agente inactivo`].filter(Boolean).join(', ');
      setNotice(previous.length === 0 ? 'La semana anterior no tiene turnos.'
        : `Semana copiada: ${created} turnos creados${skipped ? `, ${skipped} omitidos (${details})` : ''}.`);
      onChanged?.();
    } catch (error) {
      setNotice(problem(error));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return <p role="status" className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando la semana…</p>;
  if (state.status !== 'success') return <div role="alert" className="rounded-xl border border-status-danger/30 p-5 text-sm text-status-danger">
    <p>{state.status === 'forbidden' ? 'No tienes acceso al editor de turnos.'
      : state.status === 'unauthorized' ? 'La sesión expiró. Vuelve a iniciar sesión.' : 'No se pudo cargar la semana.'}</p>
    {state.status === 'error' && <button type="button" onClick={() => setLocalRevision(value => value + 1)}
      className="mt-3 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white">Reintentar</button>}
  </div>;

  const byCell = new Map(state.shifts.map(item => [`${item.rampProfileId}|${item.workDate}`, item]));
  const active = new Set(state.agents.map(agent => agent.rampProfileId));
  // Shifts left by an agent who no longer works the ramp (before the release path existed) are shown to be removed.
  const former = [...new Map(state.shifts.filter(item => !active.has(item.rampProfileId))
    .map(item => [item.rampProfileId, { rampProfileId: item.rampProfileId, agentName: item.agentName, inactive: true }]))
    .values()];
  const rows = [...state.agents, ...former];
  const selected = cell?.stations?.find(item => item.id === cell.stationId);

  return (
    <section aria-label="Editor semanal de turnos" className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Programar turnos · semana del {from} al {to}</h2>
          <p className="text-xs text-text-secondary-light">Elige una celda para asignar una plantilla en una estación y terminal del agente.</p>
        </div>
        <button type="button" disabled={busy} onClick={copyPreviousWeek}
          className="rounded-lg border border-accent-600 px-3 py-2 text-sm font-semibold text-accent-600 disabled:opacity-50">
          Copiar semana anterior</button>
      </div>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {state.absences === null && <p className="text-xs text-text-secondary-light">
        No pudimos leer las ausencias aprobadas de la semana; ELEVANT igual impide programar un turno sobre ellas.</p>}
      {rows.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm">No hay agentes de rampa activos.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-separate border-spacing-1 text-left text-xs">
            <thead><tr><th className="p-2 text-text-secondary-light">Agente</th>
              {days.map(day => <th key={toDateKey(day)} className="p-2 font-semibold capitalize">{DAY.format(day)}</th>)}</tr></thead>
            <tbody>{rows.map(agent => <tr key={agent.rampProfileId}>
              <th scope="row" className="p-2 align-top font-semibold">{agent.agentName}
                {agent.inactive
                  ? <span className="mt-1 block w-max rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold">
                    Ya no trabaja en rampa</span>
                  : <span className={`mt-1 block w-max rounded-full px-2 py-0.5 text-[10px] font-semibold ${agent.ready
                    ? 'bg-status-success/15 text-status-success' : 'bg-status-danger/15 text-status-danger'}`}>
                    {agent.ready ? 'Puede operar' : 'Le falta algo'}</span>}</th>
              {days.map(day => {
                const date = toDateKey(day);
                const shift = byCell.get(`${agent.rampProfileId}|${date}`);
                const past = date < today;
                const absence = absenceOn(state.absences, agent.rampProfileId, date);
                return <td key={date} className="h-16 rounded-lg border border-black/5 p-1 align-top dark:border-white/10">
                  {absence && <p className="mb-1 w-max rounded-full bg-status-warning/15 px-2 py-0.5 text-[10px] font-semibold text-status-warning">
                    {absence.type === 'Restriction' ? 'Restricción aprobada' : 'Ausencia aprobada'}</p>}
                  {shift ? <div className="space-y-1">
                    <p className="font-semibold">{time(shift.startsAtLocal)}–{time(shift.endsAtLocal)}</p>
                    <p className="text-text-secondary-light">{BLOCK[shift.block]} · {shift.stationCode} {shift.terminalCode}</p>
                    {!past && <div className="flex flex-wrap gap-2">
                      {!agent.inactive && <button type="button" disabled={busy} onClick={() => openAdjustment(shift)}
                        aria-label={`Ajustar horario de ${agent.agentName} el ${date}`}
                        className="text-accent-600 underline disabled:opacity-50">Ajustar</button>}
                      <button type="button" disabled={busy} onClick={() => remove(shift)}
                        aria-label={`Quitar turno de ${agent.agentName} el ${date}`}
                        className="text-status-danger underline disabled:opacity-50">Quitar</button>
                    </div>}
                  </div> : !past && !absence && !agent.inactive && <button type="button" disabled={busy}
                    onClick={() => openCell(agent, date)}
                    aria-label={`Asignar turno a ${agent.agentName} el ${date}`}
                    className="h-full w-full rounded-md text-text-secondary-light hover:bg-accent-600/10 disabled:opacity-50">+</button>}
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {adjusting && <ShiftAdjustmentForm adjusting={adjusting} busy={busy} onSubmit={saveAdjustment}
        onChange={changes => setAdjusting(current => ({ ...current, ...changes, message: '' }))}
        onCancel={() => setAdjusting(null)} />}
      {cell && (
        <form onSubmit={saveCell} aria-label="Asignar turno" className="grid gap-2 rounded-xl border border-accent-600/30 p-3 sm:grid-cols-4">
          <p className="sm:col-span-4 font-semibold">{cell.agent.agentName} · {cell.date}</p>
          {cell.status === 'loading' && <p role="status" className="sm:col-span-4 text-sm">Cargando estaciones del agente…</p>}
          {cell.status === 'error' && <p role="alert" className="sm:col-span-4 text-sm text-status-danger">{cell.message}</p>}
          {cell.status === 'ready' && (cell.stations.length === 0
            ? <p role="alert" className="sm:col-span-4 text-sm text-status-danger">El agente no tiene estación ni terminal vigente ese día.</p>
            : <>
              <label className="grid gap-1 text-sm">Plantilla
                <select value={cell.presetId} onChange={event => setCell(current => ({ ...current, presetId: event.target.value }))}
                  className="rounded-lg border px-2 py-2">{OCC_SHIFT_PRESETS.map(preset =>
                    <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Estación
                <select value={cell.stationId} onChange={event => {
                  const station = cell.stations.find(item => item.id === event.target.value);
                  setCell(current => ({ ...current, stationId: event.target.value, terminalId: station?.terminals[0]?.id ?? '' }));
                }} className="rounded-lg border px-2 py-2">{cell.stations.map(station =>
                  <option key={station.id} value={station.id}>{station.code}</option>)}</select></label>
              <label className="grid gap-1 text-sm">Terminal
                <select value={cell.terminalId} onChange={event => setCell(current => ({ ...current, terminalId: event.target.value }))}
                  className="rounded-lg border px-2 py-2">{(selected?.terminals ?? []).map(terminal =>
                    <option key={terminal.id} value={terminal.id}>{terminal.code}</option>)}</select></label>
              <div className="flex items-end gap-2">
                <button type="submit" disabled={busy || !cell.terminalId}
                  className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Asignar turno</button>
                <button type="button" onClick={() => setCell(null)} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button>
              </div>
              {cell.message && <p role="alert" className="sm:col-span-4 text-sm text-status-danger">{cell.message}</p>}
            </>)}
        </form>
      )}
    </section>
  );
}

/**
 * «Ajustar horario» of one shift (3-E): the new local start and end (an end before the start finishes the next day)
 * and the reason the audit keeps.
 */
function ShiftAdjustmentForm({ adjusting, busy, onSubmit, onChange, onCancel }) {
  const { shift, startsAtLocal, endsAtLocal } = adjusting;
  const reason = adjusting.reason.trim();
  const valid = Boolean(startsAtLocal && endsAtLocal) && startsAtLocal !== endsAtLocal && reason.length >= 5 &&
    reason.length <= 500;
  return (
    <form onSubmit={onSubmit} aria-label="Ajustar horario"
      className="grid gap-2 rounded-xl border border-accent-600/30 p-3 sm:grid-cols-4">
      <p className="sm:col-span-4 font-semibold">{shift.agentName} · {shift.workDate} · Turno actual
        {' '}{time(shift.startsAtLocal)}–{time(shift.endsAtLocal)} · {shift.stationCode} {shift.terminalCode}</p>
      <label className="grid gap-1 text-sm">Inicio
        <input type="time" step="60" required value={startsAtLocal}
          onChange={event => onChange({ startsAtLocal: event.target.value })} className="rounded-lg border px-2 py-2" /></label>
      <label className="grid gap-1 text-sm">Fin
        <input type="time" step="60" required value={endsAtLocal}
          onChange={event => onChange({ endsAtLocal: event.target.value })} className="rounded-lg border px-2 py-2" /></label>
      <label className="grid gap-1 text-sm sm:col-span-2">Motivo del ajuste
        <input type="text" maxLength={500} required value={adjusting.reason}
          onChange={event => onChange({ reason: event.target.value })} className="rounded-lg border px-2 py-2" /></label>
      {startsAtLocal && endsAtLocal && startsAtLocal > endsAtLocal &&
        <p className="sm:col-span-4 text-xs text-text-secondary-light">Termina al día siguiente, hora local de la estación.</p>}
      <p className="sm:col-span-4 text-xs text-text-secondary-light">El nuevo horario debe seguir cubriendo las posiciones
        y operaciones del agente. El motivo, de 5 a 500 caracteres, queda en la auditoría.</p>
      <div className="flex items-end gap-2 sm:col-span-4">
        <button type="submit" disabled={busy || !valid}
          className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar horario</button>
        <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button>
      </div>
      {adjusting.message && <p role="alert" className="sm:col-span-4 text-sm text-status-danger">{adjusting.message}</p>}
    </form>
  );
}
