import { useCallback, useEffect, useState } from 'react';
import {
  getAllHumanResourcesShifts, getHumanResourcesShiftAssignmentOptions, listRampAgentReadiness,
  recordHumanResourcesShift, removeHumanResourcesShift,
} from '../../../services/humanResourcesShiftsReadService';
import { OCC_SHIFT_PRESETS } from '../../planning/components/occShiftPresets';
import { addDays, toDateKey } from './mappers';

const DAY = new Intl.DateTimeFormat('es-DO', { weekday: 'short', day: 'numeric', month: 'short' });
const BLOCK = { Morning: 'Mañana', Afternoon: 'Tarde', Night: 'Noche' };
const time = value => value.slice(0, 5);
// The API takes local times with seconds (HH:mm:ss); the OCC presets are HH:mm.
const withSeconds = value => (value.length === 5 ? `${value}:00` : value);

function problem(error) {
  if (error?.status === 403) return 'Tu acceso no permite programar turnos en esa estación.';
  if (error?.status === 409) return 'Ese día ya tiene turno o el agente no tiene esa estación o terminal asignada.';
  if (error instanceof TypeError) return 'Revisa los datos del turno.';
  return 'No fue posible guardar el turno. Intenta de nuevo.';
}

/**
 * Weekly shift editor for Gestión Humana (ADR-0026): one row per ramp agent, one cell per day.
 * A cell takes a template (the same presets OCC uses) at a station and terminal of the agent,
 * or removes the shift if the day has not passed. «Copiar semana anterior» repeats last week's
 * shifts on the days that are still free.
 */
export default function WeeklyShiftEditor({ weekStart, revision = 0, onChanged }) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const from = toDateKey(days[0]);
  const to = toDateKey(days[6]);
  const today = toDateKey(new Date());
  const [state, setState] = useState({ status: 'loading' });
  const [cell, setCell] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async signal => {
    const [agents, shifts] = await Promise.all([listRampAgentReadiness(), getAllHumanResourcesShifts(from, to, { signal })]);
    return { agents, shifts };
  }, [from, to]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    load(controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ status: 'success', ...data }); })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: error?.status === 403 ? 'forbidden' : 'error' });
      });
    return () => controller.abort();
  }, [load, revision]);

  async function openCell(agent, date) {
    setNotice('');
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
    } finally {
      setBusy(false);
    }
  }

  async function remove(shift) {
    setBusy(true);
    setNotice('');
    try {
      await removeHumanResourcesShift(shift.id);
      setNotice(`Turno del ${shift.workDate} de ${shift.agentName} eliminado.`);
      onChanged?.();
    } catch (error) {
      setNotice(error?.status === 409 ? 'Los turnos pasados no se eliminan: quedan en el historial.' : problem(error));
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
      let created = 0;
      let skipped = 0;
      for (const shift of previous) {
        const date = toDateKey(addDays(new Date(`${shift.workDate}T12:00:00`), 7));
        if (date < today || taken.has(`${shift.rampProfileId}|${date}`)) { skipped++; continue; }
        try {
          await recordHumanResourcesShift(crypto.randomUUID(), { rampProfileId: shift.rampProfileId, stationId: shift.stationId,
            terminalId: shift.terminalId, workDate: date, startsAtLocal: withSeconds(shift.startsAtLocal),
            endsAtLocal: withSeconds(shift.endsAtLocal), notes: null });
          created++;
        } catch {
          skipped++;
        }
      }
      setNotice(previous.length === 0 ? 'La semana anterior no tiene turnos.'
        : `Semana copiada: ${created} turnos creados${skipped ? `, ${skipped} omitidos (día ocupado, pasado o sin acceso)` : ''}.`);
      onChanged?.();
    } catch (error) {
      setNotice(problem(error));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return <p role="status" className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">Cargando la semana…</p>;
  if (state.status !== 'success') return <p role="alert" className="rounded-xl border border-status-danger/30 p-5 text-sm text-status-danger">
    {state.status === 'forbidden' ? 'No tienes acceso al editor de turnos.' : 'No se pudo cargar la semana.'}</p>;

  const byCell = new Map(state.shifts.map(item => [`${item.rampProfileId}|${item.workDate}`, item]));
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
      {state.agents.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm">No hay agentes de rampa activos.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-separate border-spacing-1 text-left text-xs">
            <thead><tr><th className="p-2 text-text-secondary-light">Agente</th>
              {days.map(day => <th key={toDateKey(day)} className="p-2 font-semibold capitalize">{DAY.format(day)}</th>)}</tr></thead>
            <tbody>{state.agents.map(agent => <tr key={agent.rampProfileId}>
              <th scope="row" className="p-2 align-top font-semibold">{agent.agentName}
                <span className={`mt-1 block w-max rounded-full px-2 py-0.5 text-[10px] font-semibold ${agent.ready
                  ? 'bg-status-success/15 text-status-success' : 'bg-status-danger/15 text-status-danger'}`}>
                  {agent.ready ? 'Puede operar' : 'Le falta algo'}</span></th>
              {days.map(day => {
                const date = toDateKey(day);
                const shift = byCell.get(`${agent.rampProfileId}|${date}`);
                const past = date < today;
                return <td key={date} className="h-16 rounded-lg border border-black/5 p-1 align-top dark:border-white/10">
                  {shift ? <div className="space-y-1">
                    <p className="font-semibold">{time(shift.startsAtLocal)}–{time(shift.endsAtLocal)}</p>
                    <p className="text-text-secondary-light">{BLOCK[shift.block]} · {shift.stationCode} {shift.terminalCode}</p>
                    {!past && <button type="button" disabled={busy} onClick={() => remove(shift)}
                      aria-label={`Quitar turno de ${agent.agentName} el ${date}`}
                      className="text-status-danger underline disabled:opacity-50">Quitar</button>}
                  </div> : !past && <button type="button" disabled={busy} onClick={() => openCell(agent, date)}
                    aria-label={`Asignar turno a ${agent.agentName} el ${date}`}
                    className="h-full w-full rounded-md text-text-secondary-light hover:bg-accent-600/10 disabled:opacity-50">+</button>}
                </td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
      )}
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
