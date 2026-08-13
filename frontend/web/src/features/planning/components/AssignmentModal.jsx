import { useEffect, useMemo, useState } from 'react';
import { assignPlannedFlight, getPlanningOptions } from '../../../services/planningService';

export default function AssignmentModal({ flight, onClose, onAssigned }) {
  const [options, setOptions] = useState({ agents: [], services: [] });
  const [agentId, setAgentId] = useState('');
  const [serviceIds, setServiceIds] = useState([]);
  const [position, setPosition] = useState(flight?.position ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (flight) getPlanningOptions().then(setOptions).catch(err => setError(err.message)); }, [flight]);
  const services = useMemo(() => options.services.filter(service => service.contractId === flight?.contractId), [flight, options.services]);
  if (!flight) return null;
  const submit = async event => { event.preventDefault(); setSaving(true); setError(''); try { const result = await assignPlannedFlight(flight.id, { agentId, serviceIds, position }); onAssigned(result); onClose(); } catch (err) { setError(err.message); } finally { setSaving(false); } };
  const input = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-surface-dark';
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/45 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}><form role="dialog" aria-modal="true" aria-label="Asignar vuelo" onSubmit={submit} className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-2xl dark:bg-surface-dark-card">
    <div className="flex justify-between"><div><p className="text-xs font-semibold uppercase text-signal-500">Asignación operativa</p><h2 className="text-xl font-bold">{flight.flightNumber} · {flight.airlineName}</h2></div><button type="button" onClick={onClose}>✕</button></div>
    {error && <p className="rounded-xl bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <label className="block text-sm">Agente habilitado<select required className={input} value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">Seleccione…</option>{options.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
    <label className="block text-sm">Posición / puerta<input className={input} value={position} onChange={e => setPosition(e.target.value)} /></label>
    <fieldset><legend className="mb-2 text-sm font-semibold">Servicios pactados</legend><div className="grid gap-2 sm:grid-cols-2">{services.map(service => <label key={service.id} className="flex items-center gap-2 rounded-xl border p-3 text-sm"><input type="checkbox" checked={serviceIds.includes(service.id)} onChange={e => setServiceIds(ids => e.target.checked ? [...ids, service.id] : ids.filter(id => id !== service.id))} />{service.name}</label>)}</div>{!services.length && <p className="text-xs text-status-danger">Este contrato no tiene servicios habilitados.</p>}</fieldset>
    <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2">Cancelar</button><button disabled={saving || !agentId || !serviceIds.length} className="rounded-xl bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Asignando…' : 'Asignar y enviar al móvil'}</button></div>
  </form></div>;
}
