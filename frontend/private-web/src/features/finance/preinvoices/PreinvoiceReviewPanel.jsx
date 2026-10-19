import { useRef, useState } from 'react';
import { getPreinvoiceCalculations, cancelDraft, restoreDraftCalculation } from '../../../services/financePreinvoiceReviewService';
import { createPackageCommand } from '../../../services/financePackagesService';

export default function PreinvoiceReviewPanel({ preinvoice, canManage, onChanged }) {
 const [state, setState] = useState({status:'idle', lines:[]});
 const [action, setAction] = useState(null);
 const [reason, setReason] = useState('');
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState('');
 const command = useRef(createPackageCommand());
 const editable = canManage && preinvoice.status === 'Draft' && preinvoice.version;
 async function show() {
  setState(current=>({...current,status:'loading'}));
  try { setState({status:'ready',lines:await getPreinvoiceCalculations(preinvoice.id)}); }
  catch { setState({status:'error',lines:[]}); }
 }
 async function submit(event) {
  event.preventDefault(); setBusy(true); setError('');
  try {
   const send = action === 'cancel' ? cancelDraft : restoreDraftCalculation;
   await command.current(action, {expectedVersion:preinvoice.version,reason:reason.trim()}, body=>send(preinvoice.id,body));
   setAction(null); setState({status:'idle',lines:[]}); onChanged(action === 'cancel' ? 'Borrador anulado. Los servicios vuelven a estar disponibles.' : 'Cálculo original restaurado. Revise los importes antes de enviar.');
  } catch (failure) { setError(failure.status === 409 ? 'La prefactura cambió. Actualice el detalle antes de continuar.' : 'No se pudo completar la operación. Puede reintentar.'); }
  finally {setBusy(false);}
 }
 return <section className="mt-4 space-y-3 border-t border-black/10 pt-3 dark:border-white/10" aria-label="Cálculo y reservas">
  <div className="flex flex-wrap gap-3">
   <button type="button" onClick={()=>void show()} disabled={state.status==='loading'} className="text-sm font-semibold text-accent-600">{state.status==='loading'?'Cargando cálculo…':'Ver cálculo de origen'}</button>
   {editable && <><button type="button" onClick={()=>{setAction('restore');setReason('');}} className="text-sm font-semibold text-accent-600">Restaurar cálculo original</button><button type="button" onClick={()=>{setAction('cancel');setReason('');}} className="text-sm font-semibold text-status-danger">Anular borrador</button></>}
  </div>
  {state.status==='error' && <p role="alert">No se pudo consultar el cálculo. Reintente la consulta.</p>}
  {state.status==='ready' && <div className="grid gap-3 md:grid-cols-2">{state.lines.map(line=><article key={line.lineId} className="min-w-0 rounded-lg border border-black/10 p-3 text-xs dark:border-white/10"><h3 className="font-semibold">{line.description}</h3><dl className="mt-2 space-y-1">{line.steps.map((step,index)=><div key={index} className="flex flex-wrap justify-between gap-2"><dt>{step.label}</dt><dd className="font-mono">{Number(step.value).toLocaleString('es-DO',{maximumFractionDigits:4})} {step.unit} {step.currency}</dd></div>)}</dl>{line.submissionId && <p className="mt-2 break-all text-text-secondary-light">Entrega aprobada: {line.submissionId}</p>}</article>)}</div>}
  {action && <form onSubmit={submit} className="rounded-lg border border-accent-600/30 p-3 space-y-3">
   <p className="text-sm">{action==='cancel'?'La anulación libera las reservas del borrador y conserva su historial.':'Se sustituirán los importes editados por los valores calculados al crear el borrador. Las líneas de ajustes manuales se conservan.'}</p>
   <label className="block text-sm">Motivo<textarea required minLength={3} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 w-full rounded-lg border bg-white p-2 dark:bg-surface-dark" /></label>
   {error && <p role="alert">{error}</p>}
   <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy} className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?'Procesando…':action==='cancel'?'Confirmar anulación':'Confirmar restauración'}</button><button type="button" disabled={busy} onClick={()=>setAction(null)}>Volver</button></div>
  </form>}
 </section>;
}
