import { useEffect, useState } from 'react';

const EMPTY = { contractId: '', airline: '', name: '', rate: '', currency: 'USD', billingUnit: 'Por operación', startDate: '', endDate: '', active: true };

export default function ServiceFormModal({ open, service, contracts, onClose, onSubmit }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(service ? { ...service, rate: String(service.rate) } : { ...EMPTY, contractId: contracts[0]?.id ?? '', airline: contracts[0]?.airline ?? '' });
    setErrors({});
  }, [contracts, open, service]);

  if (!open) return null;
  const editing = Boolean(service);
  const inputClass = 'mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-accent-600 dark:border-white/10 dark:bg-surface-dark';

  function update(field, value) {
    setValues(current => ({ ...current, [field]: value }));
    setErrors(current => ({ ...current, [field]: undefined }));
  }

  function selectContract(contractId) {
    const contract = contracts.find(item => item.id === contractId);
    setValues(current => ({ ...current, contractId, airline: contract?.airline ?? '' }));
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!editing && !values.contractId) nextErrors.contractId = 'Selecciona un contrato.';
    if (!editing && !values.name.trim()) nextErrors.name = 'Indica el servicio.';
    if (!values.rate || Number(values.rate) <= 0) nextErrors.rate = 'Indica una tarifa válida.';
    if (!editing && !values.startDate) nextErrors.startDate = 'Indica el inicio.';
    if (!values.endDate) nextErrors.endDate = 'Indica el vencimiento.';
    if (!editing && values.startDate && values.endDate < values.startDate) nextErrors.endDate = 'La fecha final debe ser posterior.';
    if (Object.keys(nextErrors).length) return setErrors(nextErrors);
    setSaving(true);
    try {
      await onSubmit(values);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="service-form-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-surface-dark-card">
        <header className="flex items-start justify-between border-b border-black/5 px-6 py-5 dark:border-white/5"><div><p className="text-xs font-semibold uppercase tracking-widest text-signal-500">Servicios pactados</p><h2 id="service-form-title" className="mt-1 text-xl font-bold">{editing ? `Actualizar ${service.name}` : 'Agregar servicio al contrato'}</h2></div><button type="button" aria-label="Cerrar formulario" onClick={onClose} className="rounded-lg p-2 text-text-secondary-light hover:bg-black/5">✕</button></header>
        <form onSubmit={submit} className="space-y-5 p-6">
          {!editing ? <div className="grid gap-4 sm:grid-cols-2"><label htmlFor="service-contract" className="text-sm font-medium">Contrato<select id="service-contract" value={values.contractId} onChange={event => selectContract(event.target.value)} className={inputClass}>{contracts.map(contract => <option key={contract.id} value={contract.id}>{contract.id} · {contract.airline}</option>)}</select>{errors.contractId && <span className="mt-1 block text-xs text-status-danger">{errors.contractId}</span>}</label><label htmlFor="service-name" className="text-sm font-medium">Servicio<input id="service-name" value={values.name} onChange={event => update('name', event.target.value)} className={inputClass} placeholder="Ej. GPU" />{errors.name && <span className="mt-1 block text-xs text-status-danger">{errors.name}</span>}</label></div> : <div className="rounded-xl bg-accent-600/5 px-4 py-3 text-sm"><p className="font-semibold">{service.contractId} · {service.airline}</p><p>{service.name}</p></div>}
          <div className="grid gap-4 sm:grid-cols-3"><label htmlFor="service-rate" className="text-sm font-medium">Tarifa<input id="service-rate" type="number" min="0.01" step="0.01" value={values.rate} onChange={event => update('rate', event.target.value)} className={inputClass} />{errors.rate && <span className="mt-1 block text-xs text-status-danger">{errors.rate}</span>}</label><label htmlFor="service-currency" className="text-sm font-medium">Moneda<select id="service-currency" value={values.currency} onChange={event => update('currency', event.target.value)} className={inputClass}><option>USD</option><option>DOP</option></select></label><label htmlFor="service-unit" className="text-sm font-medium">Unidad de cobro<select id="service-unit" value={values.billingUnit} onChange={event => update('billingUnit', event.target.value)} className={inputClass}><option>Por operación</option><option>Por hora</option><option>Por pasajero</option><option>Por kilogramo</option></select></label></div>
          <div className="grid gap-4 sm:grid-cols-2">{!editing && <label htmlFor="service-start" className="text-sm font-medium">Inicio de vigencia<input id="service-start" type="date" value={values.startDate} onChange={event => update('startDate', event.target.value)} className={inputClass} />{errors.startDate && <span className="mt-1 block text-xs text-status-danger">{errors.startDate}</span>}</label>}<label htmlFor="service-end" className="text-sm font-medium">Fin de vigencia<input id="service-end" type="date" min={editing ? undefined : values.startDate} value={values.endDate} onChange={event => update('endDate', event.target.value)} className={inputClass} />{errors.endDate && <span className="mt-1 block text-xs text-status-danger">{errors.endDate}</span>}</label></div>
          {editing && <label className="flex items-center gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10"><input type="checkbox" checked={values.active} onChange={event => update('active', event.target.checked)} className="h-4 w-4 accent-accent-600" /><span className="text-sm font-semibold">Servicio habilitado para futuras operaciones</span></label>}
          <p className="rounded-xl bg-status-info/5 p-3 text-xs text-text-secondary-light dark:text-text-secondary-dark">Las modificaciones tarifarias aplican a futuras operaciones. El historial facturado no se altera.</p>
          <div className="flex justify-end gap-3 border-t border-black/5 pt-5 dark:border-white/5"><button type="button" onClick={onClose} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10">Cancelar</button><button type="submit" disabled={saving} className="rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agregar servicio'}</button></div>
        </form>
      </div>
    </div>
  );
}
