'use client';
import { useCallback, useState } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { decideEmployeeExpense, getEmployeeExpense, listEmployeeExpenses, saveEmployeeExpense } from '../../../services/financePayablesService';
import { usePayablesMutation, usePayablesWorkspace } from './usePayablesWorkspace';
import { PaymentForm } from './PayablePaymentsPanel';
import { buttonClass, DecisionForm, DocumentDetails, DocumentEditor, DocumentStatus, EmptyState, formatMoney, normalizedDepartment, panelClass, primaryClass, PrivateAttachments, StackedTable, WorkspaceFrame } from './PayablesUi';
export default function ExpensesPage({ ownMode = false }) {
  const { access } = useDepartmentAccess();
  const [view, setView] = useState(ownMode ? 'own' : 'all');
  const list = useCallback(filters => listEmployeeExpenses({ ...filters, ownOnly: view === 'own', departmentOnly: view === 'department' }), [view]);
  // Eligibility comes from the authenticated API options, including for members with no Finance grants.
  const w = usePayablesWorkspace('expenses', list, getEmployeeExpense, Boolean(access)); const mutation = usePayablesMutation(w.refresh);
  const canManage = w.options?.canCreateOwnExpense === true;
  const canRead = w.options?.canReadOwnExpenses || w.options?.canReadFinanceExpenses || w.options?.canReviewDepartmentExpenses;
  const [editing, setEditing] = useState(false); const [decision, setDecision] = useState(null); const [paying, setPaying] = useState(false); const d = w.detail;
  const own = d && (d.requesterId === w.session?.accountId || d.employeeId === w.options?.employeeId);
  const ownAccount = d?.requesterId === w.session?.accountId;
  const departmentReview = d?.status === 'Submitted' && !own && w.options?.canReviewDepartmentExpenses && normalizedDepartment(access?.department) === normalizedDepartment(d.department);
  const reviewedDepartment = d?.reviews?.some(r => r.stage === 'Department' && r.actorId === w.session?.accountId);
  const financeReview = d?.status === 'DepartmentApproved' && !own && !reviewedDepartment && w.options?.canApproveFinanceExpenses;
  function select(id) { setEditing(false); setDecision(null); setPaying(false); void w.open(id); }
  function changeView(value) { setEditing(false); setDecision(null); setPaying(false); w.setDetail(null); setView(value); }
  if (w.options && !canRead) return <EmptyState title="No tiene un empleado activo ni acceso a revisión de gastos." />;
  return <WorkspaceFrame title={ownMode ? "Mis gastos" : "Gastos de empleados"} description="Comprobantes privados, revisión del departamento y aprobación final de Finanzas." workspace={w} mutation={mutation} actions={canManage && <button className={primaryClass} type="button" disabled={!w.options?.employeeId || mutation.busy} onClick={() => { w.setDetail(null); setEditing(true); setDecision(null); setPaying(false); }}>Nuevo gasto</button>} statuses={['Draft', 'Submitted', 'DepartmentApproved', 'Approved', 'Rejected'].map((value, i) => ({ value, label: ['Borrador', 'Revisión de departamento', 'Pendiente de Finanzas', 'Aprobado', 'Rechazado'][i] }))}>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Vista de gastos">
      {w.options?.canReadOwnExpenses && <button className={buttonClass} aria-pressed={view === 'own'} type="button" onClick={() => changeView('own')}>Mis gastos</button>}
      {w.options?.canReviewDepartmentExpenses && <button className={buttonClass} aria-pressed={view === 'department'} type="button" onClick={() => changeView('department')}>Revisión de departamento</button>}
      {!ownMode && w.options?.canReadFinanceExpenses && <button className={buttonClass} aria-pressed={view === 'all'} type="button" onClick={() => changeView('all')}>Todos los gastos</button>}
    </div>
    {canManage && w.options && !w.options.employeeId && <EmptyState title="No hay un empleado activo vinculado a su cuenta." description="Gestión Humana debe vincular su registro laboral antes de crear gastos." />}
    {w.rows.length === 0 ? <EmptyState title="Sin gastos para estos filtros." description="Los solicitantes ven sus gastos y los administradores revisan los de su departamento." /> : <div className={panelClass}><StackedTable><table className="table-stack w-full text-left text-sm"><thead><tr>{['Gasto', 'Empleado / departamento', 'Estado', 'Saldo'].map(t => <th key={t} className="p-2 text-xs">{t}</th>)}</tr></thead><tbody>{w.rows.map(row => <tr key={row.id} className="border-t border-black/5 dark:border-white/5"><td className="p-2"><button className="text-left font-semibold text-accent-600 hover:underline" type="button" onClick={() => select(row.id)}>{row.description} · {row.expenseDate}</button></td><td className="p-2">{row.employeeNumber} · {row.department}</td><td className="p-2"><DocumentStatus status={row.status} expense /></td><td className="p-2 tabular-nums">{formatMoney(row.remaining, row.fx.currency)}</td></tr>)}</tbody></table></StackedTable></div>}
    {w.detailLoading && <p role="status">Cargando gasto…</p>}
    {d && <section className={panelClass + ' space-y-4'} aria-label="Detalle de gasto"><DocumentDetails options={w.options} detail={d} expense /><p className="text-sm">Empleado {d.employeeNumber} · {d.department}</p>
      <div className="flex flex-wrap gap-2">{d.status === 'Draft' && ownAccount && canManage && <><button type="button" className={buttonClass} disabled={mutation.busy} onClick={() => setEditing(true)}>Editar borrador</button><button className={primaryClass} type="button" disabled={mutation.busy || editing || d.receipts.length === 0} onClick={() => setDecision('Submitted')}>Enviar gasto al departamento</button></>}
        {departmentReview && <button className={primaryClass} disabled={mutation.busy} type="button" onClick={() => setDecision('DepartmentApproved')}>Aprobar departamento</button>}
        {financeReview && <button className={primaryClass} disabled={mutation.busy} type="button" onClick={() => setDecision('Approved')}>Aprobar Finanzas</button>}
        {(departmentReview || financeReview) && <button className={buttonClass} disabled={mutation.busy} type="button" onClick={() => setDecision('Rejected')}>Rechazar gasto</button>}
        {d.status === 'Approved' && !own && w.options?.canPayFinanceExpenses && <button className={primaryClass} disabled={mutation.busy || d.remaining <= 0} type="button" onClick={() => setPaying(true)}>Registrar reembolso</button>}
      </div>{d.status === 'Draft' && ownAccount && d.receipts.length === 0 && <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Adjunte un comprobante para enviar el gasto a revisión.</p>}
      {decision && <DecisionForm key={decision + d.version} decision={decision} busy={mutation.busy} onCancel={() => setDecision(null)} onConfirm={async reason => { if (await mutation.run('expense:decision:' + d.id, { decision, expectedVersion: d.version, reason }, body => decideEmployeeExpense(d.id, body))) setDecision(null); }} />}
      <PrivateAttachments key={d.id + d.version} kind="expenses" detail={d} editable={canManage && ownAccount && d.status === 'Draft' && !editing} mutation={mutation} />
      {d.reimbursements.length > 0 && <section className="space-y-2 border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-semibold">Reembolsos registrados</h3><ul className="space-y-2 text-sm">{d.reimbursements.map(p => <li key={p.id}>{p.paidOn} · {p.reference} · {formatMoney(p.amount, p.fx.currency)} · Aplicado al gasto {formatMoney(p.expenseAmount, d.fx.currency)}</li>)}</ul></section>}
    </section>}
    {editing && canManage && w.options && <DocumentEditor key={(d?.id ?? 'new') + (d?.version ?? '') + w.scope} expense detail={d} options={w.options} scope={w.scope} busy={mutation.busy} onCancel={() => setEditing(false)} onSave={async values => { if (await mutation.run('expense:save:' + (d?.id ?? 'new'), values, body => saveEmployeeExpense(d?.id, body))) setEditing(false); }} />}
    {paying && d && <PaymentForm key={d.id + d.version} detail={d} scope={w.scope} expense mutation={mutation} onClose={() => setPaying(false)} />}
  </WorkspaceFrame>;
}
