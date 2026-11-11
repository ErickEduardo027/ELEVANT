'use client';
import { useState } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { decidePayable, getPayable, listPayables, savePayable } from '../../../services/financePayablesService';
import { usePayablesMutation, usePayablesWorkspace } from './usePayablesWorkspace';
import { ApplyPaymentForm, PaymentForm, SupplierPaymentsPanel } from './PayablePaymentsPanel';
import { buttonClass, DecisionForm, DocumentDetails, DocumentEditor, DocumentStatus, EmptyState, formatMoney, normalizedDepartment, panelClass, primaryClass, PrivateAttachments, StackedTable, WorkspaceFrame } from './PayablesUi';

/** 4-N03: the corrections of a supplier invoice, with the title and confirmation of their reason form. */
const DECISIONS = {
  Submitted: { title: 'Enviar la factura a revisión', confirm: 'Confirmar envío' },
  Approved: { title: 'Confirmar revisión del documento', confirm: 'Confirmar decisión' },
  Rejected: { title: 'Confirmar revisión del documento', confirm: 'Confirmar decisión' },
  Draft: { title: 'Corregir la factura rechazada', confirm: 'Confirmar corrección', notice: 'La factura vuelve a borrador para corregirla y enviarla de nuevo.' },
  Voided: { title: 'Anular la factura', confirm: 'Confirmar anulación', notice: 'La factura queda anulada con su historial y su número de documento se libera para registrarla de nuevo.' },
};

export default function PayablesPage() {
  const { access } = useDepartmentAccess(); const canRead = Boolean(access?.can('finance.payables.read'));
  const finance = normalizedDepartment(access?.department) === 'finance'; const canCreate = finance && access?.can('finance.payables.create'); const canManage = finance && access?.can('finance.payables.update'); const canApprove = finance && access?.can('finance.payables.approve'); const canPay = finance && access?.can('finance.payables.pay');
  const canReverse = finance && access?.can('finance.payables.reverse');
  const w = usePayablesWorkspace('payables', listPayables, getPayable, canRead); const mutation = usePayablesMutation(w.refresh);
  const [editing, setEditing] = useState(false); const [decision, setDecision] = useState(null); const [paymentMode, setPaymentMode] = useState(null);
  const d = w.detail;
  // 4-N14: who created or submitted the invoice does not approve it and who approved it does not pay it; the server
  // decides by person and tells each reader whether its approval is blocked (the creator of a draft another person sent too).
  const me = w.session?.accountId;
  const approvalBlocked = d?.approvalBlocked === true;
  const approvedByMe = Boolean(me) && [...(d?.reviews ?? [])].reverse().find(r => r.stage === 'Finance' && r.decision === 'Approved')?.actorId === me;
  // 4-N15: the options only list the active suppliers of the station; a retired one keeps voiding and applying payments.
  const supplierActive = !d || !w.options || w.options.suppliers.some(s => s.id === d.supplierId);
  function select(id) { setEditing(false); setDecision(null); setPaymentMode(null); void w.open(id); }
  function decide(value) { setPaymentMode(null); setDecision(value); }
  if (!canRead) return <EmptyState title="No tiene permiso para consultar cuentas por pagar." />;
  const text = decision ? DECISIONS[decision] : null;
  return <WorkspaceFrame title="Cuentas por pagar" description="Facturas de proveedores, aprobación de gastos operativos y aplicación de pagos." workspace={w} mutation={mutation} actions={canCreate && <button className={primaryClass} type="button" disabled={!w.options || mutation.busy} onClick={() => { w.setDetail(null); setEditing(true); setDecision(null); setPaymentMode(null); }}>Nueva factura de proveedor</button>} statuses={['Draft', 'Submitted', 'Approved', 'Rejected', 'Voided'].map((value, i) => ({ value, label: ['Borrador', 'En revisión', 'Aprobado', 'Rechazado', 'Anulada'][i] }))}>
    {w.rows.length === 0 ? <EmptyState title="Sin facturas de proveedor para estos filtros." /> : <div className={panelClass}><StackedTable><table className="table-stack w-full text-left text-sm"><thead><tr>{['Documento / proveedor', 'Estado', 'Vencimiento', 'Saldo'].map(t => <th className="p-2 text-xs" key={t}>{t}</th>)}</tr></thead><tbody>{w.rows.map(row => <tr key={row.id} className="border-t border-black/5 dark:border-white/5"><td className="p-2"><button className="text-left font-semibold text-accent-600 hover:underline" type="button" onClick={() => select(row.id)}>{row.documentReference} · {row.supplierName}</button></td><td className="p-2"><DocumentStatus status={row.status} /></td><td className="p-2">{row.dueDate}</td><td className="p-2 tabular-nums">{formatMoney(row.remaining, row.fx.currency)}</td></tr>)}</tbody></table></StackedTable></div>}
    {w.detailLoading && <p role="status">Cargando factura…</p>}
    {d && <section aria-label="Detalle de cuenta por pagar" className={panelClass + ' space-y-4'}><DocumentDetails options={w.options} detail={d} />
      <div className="flex flex-wrap gap-2">{d.status === 'Draft' && canManage && <>{supplierActive && <><button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => setEditing(true)}>Editar borrador</button><button className={primaryClass} type="button" disabled={mutation.busy || editing} onClick={() => decide('Submitted')}>Enviar a revisión</button></>}<button className={buttonClass} type="button" disabled={mutation.busy || editing} onClick={() => decide('Voided')}>Anular borrador</button></>}
        {d.status === 'Submitted' && canApprove && supplierActive && <>{!approvalBlocked && <button className={primaryClass} type="button" disabled={mutation.busy} onClick={() => decide('Approved')}>Aprobar factura</button>}<button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => decide('Rejected')}>Rechazar factura</button></>}
        {d.status === 'Rejected' && canManage && <>{supplierActive && <button className={primaryClass} type="button" disabled={mutation.busy} onClick={() => decide('Draft')}>Corregir factura</button>}<button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => decide('Voided')}>Anular factura</button></>}
        {d.status === 'Approved' && canPay && !approvedByMe && <>{supplierActive && <button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => setPaymentMode('record')}>Registrar pago</button>}<button className={primaryClass} type="button" disabled={mutation.busy || d.remaining <= 0} onClick={() => setPaymentMode('apply')}>Aplicar pago existente</button></>}
        {d.status === 'Approved' && canReverse && Number(d.paid) === 0 && <button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => decide('Voided')}>Anular factura</button>}
      </div>
      {!supplierActive && ['Draft', 'Submitted', 'Rejected', 'Approved'].includes(d.status) && <p role="note" className="rounded-lg border border-status-warning/40 p-3 text-sm">Proveedor retirado: reactívelo en Proveedores para continuar.</p>}
      {d.status === 'Submitted' && canApprove && supplierActive && approvalBlocked && <p role="note" className="text-sm">Otra persona de Finanzas debe aprobar esta factura.</p>}
      {d.status === 'Approved' && canPay && approvedByMe && <p role="note" className="text-sm">Usted aprobó esta factura: otra persona de Finanzas debe registrar y aplicar sus pagos.</p>}
      {d.status === 'Approved' && canReverse && Number(d.paid) > 0 && <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Para anular esta factura, revierta antes los pagos aplicados.</p>}
      {decision && <DecisionForm key={decision + d.version} decision={decision} title={text?.title} confirmLabel={text?.confirm} notice={text?.notice} busy={mutation.busy} onCancel={() => setDecision(null)} onConfirm={async reason => { if (await mutation.run('payable:decision:' + d.id, { decision, expectedVersion: d.version, reason }, body => decidePayable(d.id, body))) setDecision(null); }} />}
      <PrivateAttachments key={d.id + d.version} kind="payables" detail={d} editable={canManage && d.status === 'Draft' && !editing} mutation={mutation} />
      {/* 4-N04, 4-N15: on every status, so a payment left without an approved invoice of its supplier is still voided. */}
      <SupplierPaymentsPanel key={d.id} detail={d} scope={w.scope} canReverse={canReverse} mutation={mutation} onOpenInvoice={select} />
    </section>}
    {editing && (d ? canManage : canCreate) && w.options && <DocumentEditor key={(d?.id ?? 'new') + (d?.version ?? '') + w.scope} detail={d} options={w.options} scope={w.scope} busy={mutation.busy} onCancel={() => setEditing(false)} onSave={async values => { if (await mutation.run('payable:save:' + (d?.id ?? 'new'), values, body => savePayable(d?.id, body))) setEditing(false); }} />}
    {d && paymentMode === 'record' && canPay && <PaymentForm detail={d} scope={w.scope} mutation={mutation} onClose={() => setPaymentMode(null)} />}
    {d && paymentMode === 'apply' && canPay && <ApplyPaymentForm key={d.id + d.version} detail={d} scope={w.scope} mutation={mutation} onClose={() => setPaymentMode(null)} onOpenInvoice={select} />}
  </WorkspaceFrame>;
}
