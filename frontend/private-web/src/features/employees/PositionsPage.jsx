import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import PageHeader from '../../components/PageHeader';
import StackedTable from '../../components/StackedTable';
import StatusBadge from '../../components/StatusBadge';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { BriefcaseIcon } from '../shell/components/icons';
import { DEPARTMENTS, DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import { governanceMessage, listPositions, savePosition } from '../../services/humanResourcesEmployeesService';
import { fieldClass } from './EmployeeForms';

/** Organisational positions per department; Human Resources owns the organigram. */
export default function PositionsPage() {
  const access = useOptionalDepartmentAccess();
  const canCreate = Boolean(access?.can('human_resources.positions.create'));
  const canManage = Boolean(access?.can('human_resources.positions.update'));
  const [department, setDepartment] = useState('');
  const [positions, setPositions] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { setPositions(await listPositions(department || undefined)); }
    catch (failure) { setPositions([]); setError(governanceMessage(failure)); }
  }, [department]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    try {
      await savePosition(form.id, { department: form.department, name: form.name.trim(), description: form.description.trim() || null,
        isRampPosition: form.department === DEPARTMENTS.OPERATIONS && form.isRampPosition, isActive: form.isActive,
        expectedVersion: form.version ?? null });
      setNotice(form.id ? 'Puesto actualizado.' : 'Puesto creado.');
      setForm(null);
      await load();
    } catch (failure) {
      setError(governanceMessage(failure));
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader eyebrow="Gestión Humana" title="Puestos"
        description="Cargos del organigrama de cada departamento. Cada departamento decide qué perfil de acceso sugiere para sus puestos."
        actions={canCreate && <button type="button" onClick={() => { setError(''); setForm({ department: department || DEPARTMENTS.OPERATIONS, name: '', description: '', isRampPosition: false, isActive: true }); }}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nuevo puesto</button>} />
      <label className="block max-w-xs text-xs font-semibold">Departamento<select value={department} onChange={event => setDepartment(event.target.value)} className={fieldClass}>
        <option value="">Todos</option>{Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && !form && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      {!positions ? <p role="status" className="text-sm">Cargando puestos…</p> : positions.length === 0 ? (
        <EmptyState icon={BriefcaseIcon} title="Sin puestos" description="Cree los cargos del organigrama." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[720px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]">
              <tr><th className="p-3">Puesto</th><th className="p-3">Departamento</th><th className="p-3">Perfil sugerido</th><th className="p-3">Empleados</th><th className="p-3">Estado</th>{canManage && <th className="p-3">Acción</th>}</tr>
            </thead>
            <tbody>{positions.map(position => (
              <tr key={position.id} className="border-t border-black/5 dark:border-white/5">
                <td className="p-3"><strong>{position.name}</strong>{position.isRampPosition && <span className="ml-2 rounded bg-accent-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-600">RAMPA</span>}
                  {position.description && <span className="block text-xs text-text-secondary-light">{position.description}</span>}</td>
                <td className="p-3">{DEPARTMENT_LABELS[position.department]}</td>
                <td className="p-3 text-xs">{position.isRampPosition ? 'App móvil' : position.suggestedAccessProfileName ?? '—'}</td>
                <td className="p-3">{position.employees}</td>
                <td className="p-3"><StatusBadge tone={position.isActive ? 'success' : 'neutral'} label={position.isActive ? 'Activo' : 'Inactivo'} /></td>
                {canManage && <td className="p-3"><button type="button" onClick={() => { setError(''); setForm({ ...position, description: position.description ?? '' }); }} className="min-h-[32px] text-xs font-semibold text-accent-600">Editar</button></td>}
              </tr>
            ))}</tbody>
          </table>
        </StackedTable>
      )}
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? 'Editar puesto' : 'Nuevo puesto'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="position-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Guardar</button></div>}>
        {form && (
          <form id="position-form" onSubmit={submit} className="space-y-3">
            {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
            <label className="block text-xs font-semibold">Departamento<select disabled={Boolean(form.id)} value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value }))} className={fieldClass}>
              {Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
            <label className="block text-xs font-semibold">Nombre<input required minLength={3} maxLength={120} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className={fieldClass} /></label>
            <label className="block text-xs font-semibold">Descripción<textarea maxLength={500} rows={2} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} className={fieldClass} /></label>
            {form.department === DEPARTMENTS.OPERATIONS && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isRampPosition} onChange={event => setForm(current => ({ ...current, isRampPosition: event.target.checked }))} />Puesto de rampa (trabaja con la app móvil)</label>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />Activo</label>
          </form>
        )}
      </Modal>
    </div>
  );
}
