import { useCallback, useEffect, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { addHoliday, loadCloseRules, removeHoliday, saveGroundTime } from '../../../services/financeCloseRulesService';

const CATEGORIES = [
  { id: 'Narrowbody', label: 'Avión estrecho', hint: 'Pillier: alrededor de 1 h a 1 h 15.' },
  { id: 'Widebody', label: 'Avión ancho', hint: 'Pillier: alrededor de 2 h a 2 h 15.' },
];

const inputClass = 'mt-1 block w-full rounded-lg border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-surface-dark-card';

function longDate(iso) {
  try {
    return new Intl.DateTimeFormat('es-DO', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
}

/**
 * «Reglas de cierre» (ADR-0034): the ground time Finance allows per aircraft category before the
 * «package exceeded» surcharge, and the holidays of the Sunday-and-holiday surcharge. ELEVANT reads
 * them when the agent hands the operation to OCC and freezes them in its evidence.
 */
export default function CloseRulesPage() {
  const { access } = useDepartmentAccess();
  const canEdit = Boolean(access?.can('finance.close_rules.update'));
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [minutes, setMinutes] = useState({});
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });

  const load = useCallback(async signal => {
    try {
      const data = await loadCloseRules({ signal });
      setState({ status: 'success', data, error: null });
      setMinutes(Object.fromEntries(data.allowances.map(item => [item.category, String(item.allowedMinutes)])));
    } catch (error) {
      if (error?.name !== 'AbortError') setState({ status: 'error', data: null, error });
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function run(action, success) {
    setBusy(true);
    setMessage({ tone: '', text: '' });
    try {
      await action();
      setMessage({ tone: 'success', text: success });
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
      await load();
    }
  }

  const allowanceOf = category => state.data?.allowances.find(item => item.category === category);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader eyebrow="Finanzas" title="Reglas de cierre"
        description="Tiempo en tierra permitido antes del recargo por paquete excedido y calendario de festivos. ELEVANT los aplica solo al entregar cada operación." />
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'}
        className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}
      {state.status === 'loading' && <p role="status" className="text-sm">Cargando reglas de cierre…</p>}
      {state.status === 'error' && (
        <div role="alert" className="space-y-2 text-sm">
          <p>{state.error.message}</p>
          {state.error.status !== 403 && <button type="button" onClick={() => { setState({ status: 'loading', data: null, error: null }); void load(); }}
            className="min-h-11 rounded-lg border border-accent-600 px-3 py-2 font-semibold">Reintentar</button>}
        </div>
      )}
      {state.status === 'success' && <>
        <section aria-label="Tiempo en tierra permitido" className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card">
          <h2 className="font-semibold">Tiempo en tierra permitido</h2>
          <p className="text-sm text-text-secondary-light">Del bloqueo al push-back. Si se supera (más la tolerancia del recargo), se marca «Tiempo extra de operación».</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {CATEGORIES.map(category => {
              const current = allowanceOf(category.id);
              const value = minutes[category.id] ?? '';
              const parsed = Number(value);
              const valid = Number.isInteger(parsed) && parsed >= 15 && parsed <= 720;
              return (
                <form key={category.id} onSubmit={event => {
                  event.preventDefault();
                  if (valid) void run(() => saveGroundTime(category.id, parsed, current?.version), `${category.label}: ${parsed} minutos guardados.`);
                }} className="rounded-xl border border-black/10 p-4 dark:border-white/10">
                  <label className="block text-sm font-semibold">{category.label} (minutos)
                    <input type="number" min={15} max={720} step={1} required disabled={!canEdit} value={value}
                      onChange={event => setMinutes(previous => ({ ...previous, [category.id]: event.target.value }))}
                      className={inputClass} />
                  </label>
                  <p className="mt-1 text-xs text-text-secondary-light">{current ? `Vigente: ${current.allowedMinutes} min.` : 'Sin configurar: no se marca paquete excedido.'} {category.hint}</p>
                  {canEdit && <button type="submit" disabled={busy || !valid || String(current?.allowedMinutes ?? '') === value}
                    className="mt-2 min-h-10 rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Guardar</button>}
                </form>
              );
            })}
          </div>
        </section>
        <section aria-label="Festivos" className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card">
          <h2 className="font-semibold">Festivos</h2>
          <p className="text-sm text-text-secondary-light">Entre las 06:00 y las 21:59 de un festivo o domingo se marca «Recargo por día festivo»; de 22:00 a 05:59 aplica el nocturno.</p>
          {canEdit && (
            <form onSubmit={event => {
              event.preventDefault();
              void run(() => addHoliday(holiday.date, holiday.name), `Festivo agregado: ${holiday.name.trim()}.`)
                .then(() => setHoliday({ date: '', name: '' }));
            }} className="flex flex-wrap items-end gap-3">
              <label className="text-sm">Fecha
                <input type="date" required value={holiday.date} onChange={event => setHoliday(previous => ({ ...previous, date: event.target.value }))}
                  className={inputClass} />
              </label>
              <label className="min-w-[240px] flex-1 text-sm">Nombre
                <input required minLength={2} maxLength={120} value={holiday.name}
                  onChange={event => setHoliday(previous => ({ ...previous, name: event.target.value }))} className={inputClass} />
              </label>
              <button type="submit" disabled={busy || !holiday.date || holiday.name.trim().length < 2}
                className="min-h-10 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Agregar festivo</button>
            </form>
          )}
          {state.data.holidays.length === 0 ? <p className="text-sm">Sin festivos registrados.</p> : (
            <ul className="divide-y divide-black/10 text-sm dark:divide-white/10">
              {state.data.holidays.map(item => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><strong>{item.name}</strong><span className="block text-xs text-text-secondary-light">{longDate(item.date)}</span></span>
                  {canEdit && <button type="button" disabled={busy} onClick={() => void run(() => removeHoliday(item.id), `Festivo quitado: ${item.name}.`)}
                    className="min-h-10 rounded-lg border border-status-warning px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Quitar</button>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </>}
    </div>
  );
}
