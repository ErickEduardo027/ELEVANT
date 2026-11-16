'use client';
import { useCallback, useState } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { decideEmployeeExpense, getEmployeeExpense, listEmployeeExpenses, saveEmployeeExpense } from '../../../services/financePayablesService';
import { usePayablesMutation, usePayablesWorkspace } from './usePayablesWorkspace';
import { PaymentForm } from './PayablePaymentsPanel';
import { buttonClass, DecisionForm, DocumentDetails, DocumentEditor, DocumentStatus, EmptyState, formatMoney, normalizedDepartment, panelClass, primaryClass, PrivateAttachments, StackedTable, WorkspaceFrame } from './PayablesUi';

const STATUSES = [['Draft', 'Borrador'], ['Submitted', 'Revisión de departamento'], ['DepartmentApproved', 'Pendiente de Finanzas'],
  ['Approved', 'Aprobado'], ['Rejected', 'Rechazado'], ['Cancelled', 'Descartado']].map(([value, label]) => ({ value, label }));

/**
 * 4-N13: the title, confirmation and notice of the decisions that change an expense's history. The requester withdraws,
 * corrects and discards its own claim; a Finance administrator reviews by escalation the claim of a department without
 * another administrator at the station. Any other decision keeps the common review form.
 */
function decisionText(decision, status, escalation) {
  if (decision === 'Draft' && status === 'Submitted') return { title: 'Retirar el gasto de la revisión', confirm: 'Confirmar retiro',
    notice: 'El gasto vuelve a borrador: podrá corregirlo y enviarlo de nuevo.' };
  if (decision === 'Draft') return { title: 'Corregir el gasto rechazado', confirm: 'Confirmar corrección',
    notice: 'El gasto vuelve a borrador para corregirlo y enviarlo de nuevo.' };
  if (decision === 'Cancelled') return { title: 'Descartar el gasto', confirm: 'Confirmar descarte',
    notice: 'El gasto queda descartado con su historial y no se puede reabrir.' };
  if (escalation) return { title: 'Revisión por escalamiento', notice: 'Usted revisa en lugar del departamento del gasto; la aprobación final la da otra persona de Finanzas.' };
  return {};
}

export default function ExpensesPage({ ownMode = false }) {
  const { access } = useDepartmentAccess();
  const [view, setView] = useState(ownMode ? 'own' : 'all');
  const list = useCallback(filters => listEmployeeExpenses({ ...filters, ownOnly: view === 'own', departmentOnly: view === 'department' }), [view]);
  // Eligibility comes from the authenticated API options, including for members with no Finance grants.
  const w = usePayablesWorkspace('expenses', list, getEmployeeExpense, Boolean(access)); const mutation = usePayablesMutation(w.refresh);
  const canManage = w.options?.canCreateOwnExpense === true;
  const canRead = w.options?.canReadOwnExpenses || w.options?.canReadFinanceExpenses || w.options?.canReviewDepartmentExpenses;
  const [editing, setEditing] = useState(false); const [decision, setDecision] = useState(null); const [paying, setPaying] = useState(false); const d = w.detail;
  const me = w.session?.accountId;
  const own = d && (d.requesterId === me || d.employeeId === w.options?.employeeId);
  const ownAccount = d?.requesterId === me;
  // 4-N13: only the requester withdraws, corrects or discards its claim; the server checks the employee too.
  const requester = Boolean(ownAccount && w.options?.canReadOwnExpenses);
  const departmentReview = d?.status === 'Submitted' && !own && w.options?.canReviewDepartmentExpenses && normalizedDepartment(access?.department) === normalizedDepartment(d.department);
  // 4-N13: without another administrator of its department at the station, a Finance administrator reviews the claim.
  const financeAdministrator = Boolean(w.options?.canReviewDepartmentExpenses) && normalizedDepartment(access?.department) === 'finance';
  const escalationReview = d?.status === 'Submitted' && !own && !departmentReview && d.reviewRoute === 'Finance' && financeAdministrator;
  // Two different people review it: who approved it for the department, or by escalation, does not give the final approval.
  const departmentApprover = [...(d?.reviews ?? [])].reverse().find(r => r.decision === 'DepartmentApproved')?.actorId;
  const reviewedByMe = Boolean(me) && departmentApprover === me;
  const financeReview = d?.status === 'DepartmentApproved' && !own && !reviewedByMe && w.options?.canApproveFinanceExpenses;
  function select(id) { setEditing(false); setDecision(null); setPaying(false); void w.open(id); }
  function changeView(value) { setEditing(false); setDecision(null); setPaying(false); w.setDetail(null); setView(value); }
  function decide(value) { setEditing(false); setPaying(false); setDecision(value); }
  if (w.options && !canRead) return <EmptyState title="No tiene un empleado activo ni acceso a revisión de gastos." />;
  const text = decision && d ? decisionText(decision, d.status, escalationReview) : {};
  return <WorkspaceFrame title={ownMode ? "Mis gastos" : "Gastos de empleados"} description="Comprobantes privados, revisión del departamento y aprobación final de Finanzas." workspace={w} mutation={mutation} actions={canManage && <button className={primaryClass} type="button" disabled={!w.options?.employeeId || mutation.busy} onClick={() => { w.setDetail(null); setEditing(true); setDecision(null); setPaying(false); }}>Nuevo gasto</button>} statuses={STATUSES}>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Vista de gastos">
      {w.options?.canReadOwnExpenses && <button className={buttonClass} aria-pressed={view === 'own'} type="button" onClick={() => changeView('own')}>Mis gastos</button>}
      {w.options?.canReviewDepartmentExpenses && <button className={buttonClass} aria-pressed={view === 'department'} type="button" onClick={() => changeView('department')}>Revisión de departamento</button>}
      {!ownMode && w.options?.canReadFinanceExpenses && <button className={buttonClass} aria-pressed={view === 'all'} type="button" onClick={() => changeView('all')}>Todos los gastos</button>}
    </div>
    {canManage && w.options && !w.options.employeeId && <EmptyState title="No hay un empleado activo vinculado a su cuenta." description="Gestión Humana debe vincular su registro laboral antes de crear gastos." />}
    {w.rows.length === 0 ? <EmptyState title="Sin gastos para estos filtros." description="Los solicitantes ven sus gastos y los administradores revisan los de su departamento." /> : <div className={panelClass}><StackedTable><table className="table-stack w-full text-left text-sm"><thead><tr>{['Gasto', 'Empleado / departamento', 'Estado', 'Saldo'].map(t => <th key={t} className="p-2 text-xs">{t}</th>)}</tr></thead><tbody>{w.rows.map(row => <tr key={row.id} className="border-t border-black/5 dark:border-white/5"><td className="p-2"><button className="text-left font-semibold text-accent-600 hover:underline" type="button" onClick={() => select(row.id)}>{row.description} · {row.expenseDate}</button></td><td className="p-2">{row.employeeNumber} · {row.department}</td><td className="p-2"><DocumentStatus status={row.status} expense /></td><td className="p-2 tabular-nums">{formatMoney(row.remaining, row.fx.currency)}</td></tr>)}</tbody></table></StackedTable></div>}
    {w.detailLoading && <p role="status">Cargando gasto…</p>}
    {d && <section className={panelClass + ' space-y-4'} aria-label="Detalle de gasto"><DocumentDetails options={w.options} detail={d} expense /><p className="text-sm">Empleado {d.employeeNumber} · {d.department}</p>
      <div className="flex flex-wrap gap-2">
        {d.status === 'Draft' && ownAccount && canManage && <><button type="button" className={buttonClass} disabled={mutation.busy} onClick={() => setEditing(true)}>Editar borrador</button><button className={primaryClass} type="button" disabled={mutation.busy || editing || d.receipts.length === 0} onClick={() => decide('Submitted')}>Enviar gasto al departamento</button></>}
        {d.status === 'Draft' && requester && <button className={buttonClass} type="button" disabled={mutation.busy || editing} onClick={() => decide('Cancelled')}>Descartar borrador</button>}
        {d.status === 'Submitted' && requester && <button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => decide('Draft')}>Retirar gasto</button>}
        {d.status === 'Rejected' && requester && <><button className={primaryClass} type="button" disabled={mutation.busy} onClick={() => decide('Draft')}>Corregir gasto</button><button className={buttonClass} type="button" disabled={mutation.busy} onClick={() => decide('Cancelled')}>Descartar gasto</button></>}
        {departmentReview && <button className={primaryClass} disabled={mutation.busy} type="button" onClick={() => decide('DepartmentApproved')}>Aprobar departamento</button>}
        {escalationReview && <button className={primaryClass} disabled={mutation.busy} type="button" onClick={() => decide('DepartmentApproved')}>Aprobar por escalamiento</button>}
        {financeReview && <button className={primaryClass} disabled={mutation.busy} type="button" onClick={() => decide('Approved')}>Aprobar Finanzas</button>}
        {(departmentReview || escalationReview || financeReview) && <button className={buttonClass} disabled={mutation.busy} type="button" onClick={() => decide('Rejected')}>Rechazar gasto</button>}
        {d.status === 'Approved' && !own && w.options?.canPayFinanceExpenses && <button className={primaryClass} disabled={mutation.busy || d.remaining <= 0} type="button" onClick={() => setPaying(true)}>Registrar reembolso</button>}
      </div>{d.status === 'Draft' && ownAccount && d.receipts.length === 0 && <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Adjunte un comprobante para enviar el gasto a revisión.</p>}
      {d.status === 'Submitted' && own && d.reviewRoute === 'Finance' && <p role="note" className="text-sm">Sin otro administrador de su departamento en la estación: lo revisa Finanzas.</p>}
      {d.status === 'Submitted' && own && d.reviewRoute === 'None' && <p role="note" className="rounded-lg border border-status-warning/40 p-3 text-sm">No hay revisor elegible: solicite a Gobernanza asignar otro administrador.</p>}
      {escalationReview && <p role="note" className="text-sm">Revisión por escalamiento: el departamento del gasto no tiene otro administrador en la estación.</p>}
      {d.status === 'DepartmentApproved' && !own && reviewedByMe && w.options?.canApproveFinanceExpenses && <p role="note" className="text-sm">Usted revisó este gasto: otra persona de Finanzas debe darle la aprobación final.</p>}
      {decision && <DecisionForm key={decision + d.version} decision={decision} title={text.title} confirmLabel={text.confirm} notice={text.notice} busy={mutation.busy} onCancel={() => setDecision(null)} onConfirm={async reason => { if (await mutation.run('expense:decision:' + d.id, { decision, expectedVersion: d.version, reason }, body => decideEmployeeExpense(d.id, body))) setDecision(null); }} />}
      <PrivateAttachments key={d.id + d.version} kind="expenses" detail={d} editable={canManage && ownAccount && d.status === 'Draft' && !editing} mutation={mutation} />
      {d.reimbursements.length > 0 && <section className="space-y-2 border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-semibold">Reembolsos registrados</h3><ul className="space-y-2 text-sm">{d.reimbursements.map(p => <li key={p.id}>{p.paidOn} · {p.reference} · {formatMoney(p.amount, p.fx.currency)} · Aplicado al gasto {formatMoney(p.expenseAmount, d.fx.currency)}</li>)}</ul></section>}
    </section>}
    {editing && canManage && w.options && <DocumentEditor key={(d?.id ?? 'new') + (d?.version ?? '') + w.scope} expense detail={d} options={w.options} scope={w.scope} busy={mutation.busy} onCancel={() => setEditing(false)} onSave={async values => { if (await mutation.run('expense:save:' + (d?.id ?? 'new'), values, body => saveEmployeeExpense(d?.id, body))) setEditing(false); }} />}
    {paying && d && <PaymentForm key={d.id + d.version} detail={d} scope={w.scope} expense mutation={mutation} onClose={() => setPaying(false)} />}
  </WorkspaceFrame>;
}
