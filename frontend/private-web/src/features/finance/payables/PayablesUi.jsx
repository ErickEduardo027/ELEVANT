'use client';
import { useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import EmptyState from '../../../components/EmptyState';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
function formatMoney(value, currency) {
  const amount = Number(value);
  if (value === null || value === undefined || !Number.isFinite(amount)) return '—';
  return (currency ? currency + ' ' : '') + amount.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
import { downloadPayablesAttachment, uploadPayablesAttachment } from '../../../services/financePayablesService';
import { payablesError } from './usePayablesWorkspace';
export const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus-visible:outline-accent-600 dark:border-white/10 dark:bg-surface-dark';
export const panelClass = 'rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-surface-dark-card sm:p-5';
export const buttonClass = 'rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold hover:bg-black/5 focus-visible:outline-accent-600 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5';
export const primaryClass = 'rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 focus-visible:outline-accent-600 disabled:opacity-50';
export const today = () => { const date = new Date(); return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); };
export const normalizedDepartment = value => String(value ?? '').replace(/[-_]/g, '').toLowerCase();
export function Field({ label, children }) { return <label className="block min-w-0 text-xs font-semibold">{label}{children}</label>; }
export function Choice({ label, value, onChange, choices = [], required = false, disabled = false, empty = 'Sin dimensión' }) {
  return <Field label={label}><select className={fieldClass} value={value ?? ''} onChange={e => onChange(e.target.value)} required={required} disabled={disabled}>
    <option value="">{required ? 'Seleccione…' : empty}</option>{choices.map(x => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
  </select></Field>;
}
const statuses = { Draft: ['Borrador', 'warning'], Submitted: ['En revisión de departamento', 'info'], DepartmentApproved: ['Pendiente de Finanzas', 'info'], Approved: ['Aprobado', 'success'], Rejected: ['Rechazado', 'danger'] };
export function DocumentStatus({ status, expense = false }) { const [label, tone] = statuses[status] ?? [status, 'neutral']; return <StatusBadge label={status === 'Submitted' && !expense ? 'En revisión de Finanzas' : label} tone={tone} />; }
export function MutationNotice({ mutation }) {
  return <><div aria-live="polite">{mutation.success && <p role="status" className="rounded-lg border border-status-success/30 p-3 text-sm">{mutation.success}</p>}</div>
    {mutation.error && <div role="alert" className="rounded-lg border border-status-danger/40 p-3 text-sm"><p>{mutation.error}</p>{mutation.retry && <button className={buttonClass + ' mt-2'} type="button" disabled={mutation.busy} onClick={mutation.retry}>Reintentar acción</button>}</div>}</>;
}
export function WorkspaceFrame({ title, description, workspace: w, mutation, actions, statuses: choices = [], dateFilters = true, children }) {
  return <div className="space-y-4 text-ink-900 dark:text-text-primary-dark">
    <PageHeader eyebrow="Finanzas · operaciones de rampa" title={title} description={description} actions={actions} />
    <div className={panelClass + ' grid gap-3 sm:grid-cols-2 lg:grid-cols-5'}>
      <Field label="Estación"><select className={fieldClass} value={w.scope} onChange={e => w.changeScope(e.target.value)} disabled={mutation.busy}>{w.stations.map(s => <option key={s.stationId} value={s.stationId}>{s.stationCode}</option>)}</select></Field>
      <Field label="Buscar"><input className={fieldClass} value={w.filter.search} onChange={e => w.setFilter(f => ({ ...f, search: e.target.value, skip: 0 }))} /></Field>
      {choices.length > 0 && <Field label="Estado"><select className={fieldClass} value={w.filter.status} onChange={e => w.setFilter(f => ({ ...f, status: e.target.value, skip: 0 }))}><option value="">Todos</option>{choices.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>}
      {dateFilters && <Field label="Desde"><input className={fieldClass} type="date" value={w.filter.from} onChange={e => w.setFilter(f => ({ ...f, from: e.target.value, skip: 0 }))} /></Field>}
      {dateFilters && <Field label="Hasta"><input className={fieldClass} type="date" min={w.filter.from || undefined} value={w.filter.to} onChange={e => w.setFilter(f => ({ ...f, to: e.target.value, skip: 0 }))} /></Field>}
    </div>
    <MutationNotice mutation={mutation} />
    {w.changed && <div role="status" className={panelClass}><p className="text-sm">Hay cambios disponibles en estos documentos.</p><button type="button" className={buttonClass + ' mt-2'} disabled={mutation.busy} onClick={() => w.refresh()}>Actualizar documentos</button></div>}
    {w.error && <div role="alert" className={panelClass + ' border-status-danger/40'}><p>{w.error}</p><button className={buttonClass + ' mt-2'} onClick={() => w.refresh()} type="button">Reintentar carga</button></div>}
    {w.loading ? <p role="status" className={panelClass}>Cargando documentos…</p> : !w.scope ? <EmptyState title="No tiene estaciones asignadas." description="Solicite el ámbito de estación a su administrador." /> : children}
    {w.scope && <nav aria-label="Páginas de resultados" className="flex items-center justify-end gap-3 text-sm"><button className={buttonClass} type="button" disabled={w.loading || w.filter.skip === 0} onClick={() => w.setFilter(f => ({ ...f, skip: Math.max(0, f.skip - f.take) }))}>Anterior</button><span>Página {Math.floor(w.filter.skip / w.filter.take) + 1}</span><button className={buttonClass} type="button" disabled={w.loading || w.rows.length < w.filter.take} onClick={() => w.setFilter(f => ({ ...f, skip: f.skip + f.take }))}>Siguiente</button></nav>}
  </div>;
}
export function FxFields({ value, onChange, maxDate }) {
  const patch = values => onChange({ ...value, ...values });
  return <fieldset className="grid gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-4"><legend className="px-1 text-xs font-semibold">Moneda y tasa congelada a DOP</legend>
    <Field label="Moneda"><select className={fieldClass} value={value.currency} onChange={e => patch({ currency: e.target.value, rateToDop: '' })}><option>USD</option><option>DOP</option></select></Field>
    <Field label="Tasa a DOP"><input className={fieldClass} required type="number" min={value.currency === 'DOP' ? '1' : '0.00000001'} max={value.currency === 'DOP' ? '1' : '1000000'} step="0.00000001" value={value.rateToDop ?? ''} onChange={e => patch({ rateToDop: e.target.value })} /></Field>
    <Field label="Fuente de la tasa"><input className={fieldClass} required maxLength={160} value={value.source} onChange={e => patch({ source: e.target.value })} /></Field>
    <Field label="Fecha de la tasa"><input className={fieldClass} required type="date" max={maxDate} value={value.rateDate} onChange={e => patch({ rateDate: e.target.value })} /></Field>
    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark sm:col-span-2 lg:col-span-4">Indique la tasa revisada. Para documentos en DOP debe ser 1. El documento conserva esta tasa.</p>
  </fieldset>;
}
export const fxBody = fx => ({ ...fx, rateToDop: fx.rateToDop === '' ? null : Number(fx.rateToDop) });
export const emptyFx = () => ({ currency: 'USD', rateToDop: '', source: '', rateDate: today() });
export function DocumentEditor({ expense = false, detail, options, scope, busy, onSave, onCancel }) {
  const [meta, setMeta] = useState(() => ({ supplierId: detail?.supplierId ?? '', documentReference: detail?.documentReference ?? '', description: detail?.description ?? '', documentDate: detail?.documentDate ?? detail?.expenseDate ?? today(), dueDate: detail?.dueDate ?? today() }));
  const [fx, setFx] = useState(() => detail?.fx ?? emptyFx()); const [dimensions, setDimensions] = useState(() => detail?.dimensions ?? {});
  const [lines, setLines] = useState(() => detail?.lines?.map(l => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxAmount: l.taxAmount })) ?? [{ description: '', quantity: 1, unitPrice: '', taxAmount: 0 }]);
  const patch = values => setMeta(m => ({ ...m, ...values }));
  function submit(e) {
    e.preventDefault();
    onSave({ scopeStationId: scope, ...(expense ? { description: meta.description, expenseDate: meta.documentDate } : { supplierId: meta.supplierId, documentReference: meta.documentReference, documentDate: meta.documentDate, dueDate: meta.dueDate }),
      fx: fxBody(fx), dimensions: Object.fromEntries(['stationId', 'airlineId', 'turnaroundId', 'serviceId'].map(k => [k, dimensions[k] || null])),
      lines: lines.map(l => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), taxAmount: Number(l.taxAmount) })), expectedVersion: detail?.version ?? null });
  }
  return <form aria-label={expense ? 'Borrador de gasto' : 'Borrador de factura de proveedor'} onSubmit={submit} className={panelClass + ' space-y-4'}>
    <h2 className="text-lg font-bold">{detail ? 'Editar borrador' : expense ? 'Nuevo gasto de empleado' : 'Nueva factura de proveedor'}</h2>
    <fieldset disabled={busy} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {expense ? <Field label="Concepto del gasto"><input className={fieldClass} required maxLength={500} value={meta.description} onChange={e => patch({ description: e.target.value })} /></Field> : <><Choice label="Proveedor" value={meta.supplierId} onChange={supplierId => patch({ supplierId })} choices={options.suppliers} required /><Field label="Referencia del proveedor"><input className={fieldClass} required maxLength={100} value={meta.documentReference} onChange={e => patch({ documentReference: e.target.value })} /></Field></>}
      <Field label={expense ? 'Fecha del gasto' : 'Fecha del documento'}><input className={fieldClass} type="date" required value={meta.documentDate} onChange={e => patch({ documentDate: e.target.value })} /></Field>
      {!expense && <Field label="Vencimiento"><input className={fieldClass} required type="date" min={meta.documentDate} value={meta.dueDate} onChange={e => patch({ dueDate: e.target.value })} /></Field>}
    </div><FxFields value={fx} onChange={setFx} maxDate={meta.documentDate} />
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><legend className="mb-2 text-xs font-semibold">Dimensiones operativas opcionales</legend>{[['stationId', 'Estación operativa', options.stations.filter(station => station.id === scope)], ['airlineId', 'Aerolínea', options.airlines], ['turnaroundId', 'Escala', options.turnarounds], ['serviceId', 'Servicio', options.services]].map(([key, label, choices]) => <Choice key={key} label={label} value={dimensions[key]} choices={choices} onChange={value => setDimensions(d => ({ ...d, [key]: value }))} />)}</fieldset>
      <div className="space-y-3"><h3 className="font-semibold">Líneas del documento</h3>{lines.map((line, i) => <div key={i} className="grid gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-5"><Field label={'Descripción de línea ' + (i + 1)}><input className={fieldClass} required maxLength={500} value={line.description} onChange={e => setLines(ls => ls.map((l, n) => n === i ? { ...l, description: e.target.value } : l))} /></Field>{[['quantity', 'Cantidad', '0.0001'], ['unitPrice', 'Precio unitario', '0'], ['taxAmount', 'Impuesto explícito', '0']].map(([key, label, min]) => <Field key={key} label={label + ' de línea ' + (i + 1)}><input className={fieldClass} required type="number" step="0.0001" min={min} value={line[key]} onChange={e => setLines(ls => ls.map((l, n) => n === i ? { ...l, [key]: e.target.value } : l))} /></Field>)}<button className={buttonClass} type="button" aria-label={'Quitar línea ' + (i + 1)} disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter((_, n) => n !== i))}>Quitar línea</button></div>)}</div>
      <button className={buttonClass} type="button" disabled={lines.length >= 100} onClick={() => setLines(ls => [...ls, { description: '', quantity: 1, unitPrice: '', taxAmount: 0 }])}>Añadir línea</button>
      <div className="flex flex-wrap gap-2"><button className={primaryClass} type="submit">Guardar borrador</button><button className={buttonClass} type="button" onClick={onCancel}>Cancelar edición</button></div>
    </fieldset>
  </form>;
}
export function DocumentDetails({ detail: d, expense = false, options }) {
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{expense ? d.description : d.documentReference}</h2><DocumentStatus status={d.status} expense={expense} /></div>
    <dl className="grid gap-3 rounded-xl bg-black/[.03] p-3 text-sm dark:bg-white/5 sm:grid-cols-3">{[['Total', d.total], ['Pagado', d.paid], ['Saldo pendiente', d.remaining]].map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</dt><dd className="mt-1 font-bold tabular-nums">{formatMoney(value, d.fx.currency)}</dd></div>)}</dl>
    {options && <dl className="flex flex-wrap gap-4 text-xs">{[['stationId', 'Estación operativa', options.stations], ['airlineId', 'Aerolínea', options.airlines], ['turnaroundId', 'Escala', options.turnarounds], ['serviceId', 'Servicio', options.services]].filter(([key]) => d.dimensions?.[key]).map(([key, label, choices]) => <div key={key}><dt className="font-semibold">{label}</dt><dd>{choices.find(choice => choice.id === d.dimensions[key])?.name ?? 'Referencia histórica'}</dd></div>)}</dl>}
    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Tasa a DOP {d.fx.rateToDop} · {d.fx.source} · {d.fx.rateDate} · Total DOP {formatMoney(d.totalDop)}</p>
    <StackedTable><table className="table-stack w-full text-left text-sm"><thead><tr>{['Línea', 'Cantidad', 'Precio', 'Impuesto', 'Total'].map(h => <th className="p-2 text-xs" key={h}>{h}</th>)}</tr></thead><tbody>{d.lines.map(l => <tr key={l.id} className="border-t border-black/5 dark:border-white/5"><td className="p-2">{l.description}</td><td className="p-2 tabular-nums">{l.quantity}</td><td className="p-2">{formatMoney(l.unitPrice, d.fx.currency)}</td><td className="p-2">{formatMoney(l.taxAmount)}</td><td className="p-2">{formatMoney(l.total)}</td></tr>)}</tbody></table></StackedTable>
    {d.reviews.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold">Historial de revisión ({d.reviews.length})</summary><ol className="mt-2 space-y-2 text-xs">{d.reviews.map((r, i) => <li key={i} className="border-l-2 border-accent-600/40 pl-3">{r.stage} · {r.decision} · {new Date(r.at).toLocaleString('es-DO')}{r.reason && <p>{r.reason}</p>}</li>)}</ol></details>}
  </div>;
}
export function PrivateAttachments({ kind, detail, editable, mutation }) {
  const [file, setFile] = useState(null); const [error, setError] = useState(''); const [downloading, setDownloading] = useState(null);
  const receipts = detail.receipts ?? detail.attachments ?? [];
  async function download(id) { setDownloading(id); setError(''); try { await downloadPayablesAttachment(kind, detail.id, id); } catch (e) { setError(payablesError(e)); } finally { setDownloading(null); } }
  return <section className="space-y-3 border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-semibold">Comprobantes privados</h3>
    {error && <p role="alert">{error}</p>}{receipts.length === 0 && <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Sin comprobantes adjuntos.</p>}
    <ul className="flex flex-wrap gap-2">{receipts.map((r, i) => <li key={r.id}><button className={buttonClass} disabled={downloading !== null} onClick={() => download(r.id)} type="button">Descargar comprobante {i + 1} · {Math.ceil(r.length / 1024)} KB</button></li>)}</ul>
    {editable && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); if (!file) return; setError(''); if (file.size > 8 * 1024 * 1024 || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { setError('Use PDF, PNG o JPEG de hasta 8 MB.'); return; } void mutation.run('upload:' + kind + ':' + detail.id, { expectedVersion: detail.version, fileInfo: { size: file.size, name: file.name, type: file.type, lastModified: file.lastModified } }, body => uploadPayablesAttachment(kind, detail.id, { requestId: body.requestId, expectedVersion: body.expectedVersion, file })); }}><Field label="Adjuntar comprobante privado"><input className={fieldClass} required type="file" accept="application/pdf,image/png,image/jpeg" onChange={e => setFile(e.target.files[0] ?? null)} disabled={mutation.busy} /></Field><button className={buttonClass} disabled={mutation.busy || !file} type="submit">Subir comprobante</button><p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">PDF, PNG o JPEG · máximo 8 MB</p></form>}
  </section>;
}
export function DecisionForm({ decision, busy, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  return <form className="space-y-3 rounded-xl border border-accent-600/30 p-4" onSubmit={e => { e.preventDefault(); onConfirm(reason.trim() || null); }}><h3 className="font-semibold">Confirmar revisión del documento</h3><Field label="Motivo de la decisión"><textarea className={fieldClass} maxLength={500} required={decision === 'Rejected'} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></Field><div className="flex gap-2"><button type="submit" className={primaryClass} disabled={busy}>Confirmar decisión</button><button type="button" className={buttonClass} disabled={busy} onClick={onCancel}>Cancelar decisión</button></div></form>;
}
export { EmptyState, StackedTable, formatMoney };
