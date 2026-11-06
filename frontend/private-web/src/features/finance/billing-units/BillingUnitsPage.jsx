import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import Modal from '../../../components/Modal';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import { TariffIcon } from '../components/icons';
import LoadFailure, { loadFailure } from '../components/LoadFailure';
import { listBillingUnits, saveBillingUnit } from '../../../services/financeBookService';
import { financeTariffMessage } from '../../../services/financeErrors';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const SCALE_LABELS = ['Enteros (1, 2, 3)', '1 decimal', '2 decimales', '3 decimales', '4 decimales'];

/** One Spanish message per code (1-E); the server title is never shown. */
const saveError = failure => financeTariffMessage(failure, { fallback: 'No se pudo guardar la unidad.',
  forbidden: 'No tiene permiso para gestionar las unidades de cobro.' });

/**
 * Units in which services and charges are measured and priced (per operation, hour, passenger…).
 * Units are never deleted: deactivating one hides it from new prices and services.
 */
export default function BillingUnitsPage({ canCreate = false, canUpdate = false }) {
  const [units, setUnits] = useState(null);
  const [error, setError] = useState('');
  // A list that failed to load shows a recoverable error, never «Sin unidades de cobro».
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setUnits(await listBillingUnits()); setLoadError(null); }
    catch (failure) {
      setUnits(null);
      setLoadError(loadFailure(failure, financeTariffMessage(failure, {
        fallback: 'No se pudieron cargar las unidades de cobro. Revise la conexión e intente de nuevo.',
        forbidden: 'No tiene acceso a las unidades de cobro.' })));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveBillingUnit(form.id ?? null, {
        code: form.code.trim().toLowerCase(), name: form.name.trim(), quantityScale: Number(form.quantityScale),
        isActive: form.isActive, expectedVersion: form.version ?? null,
      });
      setNotice(form.id ? `Unidad «${form.name.trim()}» actualizada.` : `Unidad «${form.name.trim()}» creada.`);
      setForm(null);
      await load();
    } catch (failure) {
      setError(saveError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <PageHeader eyebrow="Finanzas · Tarifarios" title="Unidades de cobro"
        description="Cómo se mide lo que se cobra: por operación, por hora, por pasajero… Las usan el catálogo de servicios, el tarifario de servicios y el de cargos."
        actions={canCreate && <button type="button" onClick={() => { setNotice(''); setError(''); setForm({ code: '', name: '', quantityScale: 0, isActive: true }); }}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nueva unidad</button>} />
      <p className="rounded-lg border border-black/5 bg-white p-3 text-xs text-text-secondary-light dark:border-white/5 dark:bg-surface-dark-card">
        La unidad solo indica cómo se mide. Una espera por demora del vuelo no es una unidad: se cobra con el cargo <strong>DELAY</strong> («Demora de la llegada»), que se mide por hora y tiene minutos de gracia en el tarifario de cargos.
      </p>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && !form && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      <LoadFailure failure={loadError} onRetry={() => { void load(); }} />
      {!units ? (loadError ? null : <p role="status" className="text-sm">Cargando unidades…</p>) : units.length === 0 ? (
        <EmptyState icon={TariffIcon} title="Sin unidades de cobro" description="Cree la primera unidad para poder tarifar servicios y cargos." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[560px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]">
              <tr><th className="p-3">Nombre</th><th className="p-3">Código</th><th className="p-3">Cantidades</th><th className="p-3">Estado</th>{canUpdate && <th className="p-3">Acción</th>}</tr>
            </thead>
            <tbody>{units.map(unit => (
              <tr key={unit.id} className={`border-t border-black/5 dark:border-white/5 ${unit.isActive ? '' : 'opacity-60'}`}>
                <td className="p-3 font-semibold">Por {unit.name.toLocaleLowerCase('es')}</td>
                <td className="p-3 font-mono text-xs">{unit.code}</td>
                <td className="p-3 text-xs">{SCALE_LABELS[unit.quantityScale] ?? unit.quantityScale}</td>
                <td className="p-3 text-xs">{unit.isActive ? 'Activa' : 'Inactiva'}</td>
                {canUpdate && <td className="p-3"><button type="button" onClick={() => { setNotice(''); setError(''); setForm({ ...unit }); }}
                  className="min-h-[32px] text-xs font-semibold text-accent-600">Editar</button></td>}
              </tr>
            ))}</tbody>
          </table>
        </StackedTable>
      )}
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? `Editar «${form.name}»` : 'Nueva unidad de cobro'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="billing-unit-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar</button></div>}>
        {form && (
          <form id="billing-unit-form" onSubmit={submit} className="space-y-3">
            {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
            <label className="block text-xs font-semibold">Nombre (se lee «Por …»)<input required minLength={2} maxLength={80} value={form.name}
              onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Operación" className={fieldClass} /></label>
            <label className="block text-xs font-semibold">Código interno<input required disabled={Boolean(form.id)} pattern="[a-z0-9-]{2,32}"
              data-error="Use de 2 a 32 letras minúsculas, dígitos o guiones, p. ej. operation." value={form.code}
              onChange={event => setForm(current => ({ ...current, code: event.target.value.toLowerCase() }))} placeholder="operation" className={fieldClass} /></label>
            <label className="block text-xs font-semibold">Cantidades admitidas<select value={form.quantityScale}
              onChange={event => setForm(current => ({ ...current, quantityScale: Number(event.target.value) }))} className={fieldClass}>
              {SCALE_LABELS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
            <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive}
              onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />Activa (disponible para servicios y tarifas nuevas)</label>
          </form>
        )}
      </Modal>
    </div>
  );
}
