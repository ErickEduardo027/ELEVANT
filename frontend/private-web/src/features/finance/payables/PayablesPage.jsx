'use client';
import { useState } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { decidePayable, getPayable, listPayables, savePayable } from '../../../services/financePayablesService';
import { usePayablesMutation, usePayablesWorkspace } from './usePayablesWorkspace';
import { ApplyPaymentForm, PaymentForm } from './PayablePaymentsPanel';
import { buttonClass, DecisionForm, DocumentDetails, DocumentEditor, DocumentStatus, EmptyState, formatMoney, normalizedDepartment, panelClass, primaryClass, PrivateAttachments, StackedTable, WorkspaceFrame } from './PayablesUi';
export default function PayablesPage() {
  const { access } = useDepartmentAccess(); const canRead = Boolean(access?.can('finance.payables.read'));
  const finance = normalizedDepartment(access?.department) === 'finance'; const canManage = finance && access?.can('finance.payables.manage'); const canApprove = finance && access?.can('finance.payables.approve'); const canPay = finance && access?.can('finance.payables.pay');
  const w = usePayablesWorkspace('payables', listPayables, getPayable, canRead); const mutation = usePayablesMutation(w.refresh);
  const [editing, setEditing] = useState(false); const [decision, setDecision] = useState(null); const [paymentMode, setPaymentMode] = useState(null);
  const d = w.detail;
  function select(id) { setEditing(false); setDecision(null); setPaymentMode(null); void w.open(id); }
  if (!canRead) return <EmptyState title="No tiene permiso para consultar cuentas por pagar." />;
  return <WorkspaceFrame title="Cuentas por pagar" description="Facturas de proveedores, aprobación de gastos operativos y aplicación de pagos." workspace={w} mutation={mutation} actions={canManage && <button className={primaryClass} type="button" disabled={!w.options || mutation.busy} onClick={() => { w.setDetail(null); setEditing(true); setDecision(null); setPaymentMode(null); }}>Nueva factura de proveedor</button>} statuses={['Draft', 'Submitted', 'Approved', 'Rejected'].map((value, i) => ({ value, label: ['Borrador', 'En revisión', 'Aprobado', 'Rechazado'][i] }))}>
    {w.rows.length === 0 ? <EmptyState title="Sin facturas de proveedor para estos filtros." /> : <div className={panelClass}><StackedTable><table className="table-stack w-full text-left text-sm"><thead><tr>{['Documento / proveedor', 'Estado', 'Vencimiento', 'Saldo'].map(t => <th className="p-2 text-xs" key={t}>{t}</th>)}</tr></thead><tbody>{w.rows.map(row => <tr key={row.id} className="border-t border-black/5 dark:border-white/5"><td className="p-2"><button className="text-left font-semibold text-accent-600 hover:underline" type="button" onClick={() => select(row.id)}>{row.documentReference} · {row.supplierName}</button></td><td className="p-2"><DocumentStatus status={row.status} /></td><td className="p-2">{row.dueDate}</td><td className="p-2 tabular-nums">{formatMoney(row.remaining, row.fx.currency)}</td></tr>)}</tbody></table></StackedTable></div>}
    {w.detailLoading && <p role="status">Cargando factura…</p>}
    {d && <section aria-label="Detalle de cuenta por pagar" className={panelClass + ' space-y-4'}><DocumentDetails options={w.options} detail={d} />
      <div className="flex flex-wrap gap-2">{d.status === 'Draft' && canManage && <><button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => setEditing(true)}>Editar borrador</button><button className={primaryClass} type="button" disabled={mutation.busy || editing} onClick={() => setDecision('Submitted')}>Enviar a revisión</button></>}
        {d.status === 'Submitted' && canApprove && <><button className={primaryClass} type="button" disabled={mutation.busy} onClick={() => setDecision('Approved')}>Aprobar factura</button><button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => setDecision('Rejected')}>Rechazar factura</button></>}
        {d.status === 'Approved' && canPay && <><button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => setPaymentMode('record')}>Registrar pago</button><button className={primaryClass} type="button" disabled={mutation.busy || d.remaining <= 0} onClick={() => setPaymentMode('apply')}>Aplicar pago existente</button></>}
      </div>
      {decision && <DecisionForm key={decision + d.version} decision={decision} busy={mutation.busy} onCancel={() => setDecision(null)} onConfirm={async reason => { if (await mutation.run('payable:decision:' + d.id, { decision, expectedVersion: d.version, reason }, body => decidePayable(d.id, body))) setDecision(null); }} />}
      <PrivateAttachments key={d.id + d.version} kind="payables" detail={d} editable={canManage && d.status === 'Draft' && !editing} mutation={mutation} />
    </section>}
    {editing && canManage && w.options && <DocumentEditor key={(d?.id ?? 'new') + (d?.version ?? '') + w.scope} detail={d} options={w.options} scope={w.scope} busy={mutation.busy} onCancel={() => setEditing(false)} onSave={async values => { if (await mutation.run('payable:save:' + (d?.id ?? 'new'), values, body => savePayable(d?.id, body))) setEditing(false); }} />}
    {d && paymentMode === 'record' && canPay && <PaymentForm detail={d} scope={w.scope} mutation={mutation} onClose={() => setPaymentMode(null)} />}
    {d && paymentMode === 'apply' && canPay && <ApplyPaymentForm key={d.id + d.version} detail={d} scope={w.scope} mutation={mutation} onClose={() => setPaymentMode(null)} onOpenInvoice={select} />}
  </WorkspaceFrame>;
}
