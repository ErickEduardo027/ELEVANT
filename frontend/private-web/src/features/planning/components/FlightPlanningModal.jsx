import { useEffect, useState } from 'react';
import { createPlannedFlight, getPlanningOptions } from '../../../services/planningService';

const EMPTY = { contractId: '', flightNumber: '', origin: '', destination: 'PUJ', scheduledTime: '', aircraftType: '', position: '', status: 'scheduled', observations: '' };

export default function FlightPlanningModal({ open, onClose, onCreated }) {
  const [values, setValues] = useState(EMPTY);
  const [contracts, setContracts] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValues(EMPTY); setError('');
    getPlanningOptions().then(data => setContracts(data.contracts)).catch(err => setError(err.message));
  }, [open]);
  if (!open) return null;
  const input = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm dark:border-white/10 dark:bg-surface-dark';
  const update = (key, value) => setValues(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try { const created = await createPlannedFlight(values); onCreated(created); onClose(); }
    catch (err) { setError(err.message); } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/45 p-4" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <form role="dialog" aria-modal="true" aria-label="Registrar vuelo contratado" onSubmit={submit} className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-surface-dark-card">
      <div className="flex justify-between"><div><p className="text-xs font-semibold uppercase text-signal-500">Planificación OCC</p><h2 className="text-xl font-bold">Registrar vuelo contratado</h2></div><button type="button" onClick={onClose}>✕</button></div>
      {error && <p className="rounded-xl bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      <label className="block text-sm font-medium">Aerolínea con contrato activo<select required className={input} value={values.contractId} onChange={e => update('contractId', e.target.value)}><option value="">Seleccione…</option>{contracts.map(c => <option key={c.id} value={c.id}>{c.airline} · {c.id}</option>)}</select></label>
      {!contracts.length && <p className="text-xs text-text-secondary-light">Primero debe existir un contrato activo con servicios pactados.</p>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Número de vuelo<input required className={input} value={values.flightNumber} onChange={e => update('flightNumber', e.target.value)} /></label><label className="text-sm">Fecha y hora<input required type="datetime-local" className={input} value={values.scheduledTime} onChange={e => update('scheduledTime', e.target.value)} /></label><label className="text-sm">Origen<input required maxLength={3} className={input} value={values.origin} onChange={e => update('origin', e.target.value)} /></label><label className="text-sm">Destino<input required maxLength={3} className={input} value={values.destination} onChange={e => update('destination', e.target.value)} /></label><label className="text-sm">Aeronave<input required className={input} value={values.aircraftType} onChange={e => update('aircraftType', e.target.value)} /></label><label className="text-sm">Posición / puerta<input className={input} value={values.position} onChange={e => update('position', e.target.value)} /></label></div>
      <label className="block text-sm">Observaciones<textarea className={input} rows={3} value={values.observations} onChange={e => update('observations', e.target.value)} /></label>
      <div className="flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border px-4 py-2">Cancelar</button><button disabled={saving || !contracts.length} className="rounded-xl bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Registrando…' : 'Registrar vuelo'}</button></div>
    </form>
  </div>;
}
