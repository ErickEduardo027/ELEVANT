import { useEffect, useRef, useState } from 'react';
import Drawer from '../../../components/Drawer';
import Modal from '../../../components/Modal';
import { getContractDocument, signContractVersion, withdrawContractVersion } from '../../../services/commercialGovernanceApi';
import { billingUnitLabel } from '../../../services/billingUnits';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { contractDocumentMessage } from '../../../services/commercialProblems';
import { isConflict } from '../../../services/problemMessages';
import SignaturePad from '../../../components/SignaturePad';
import ContractLifecyclePanel from './ContractLifecyclePanel';
import ContractPdfButtons from './ContractPdfButtons';
import ContractValidityForm from './ContractValidityForm';

const PARTY = { Aviam: 'AVIAM', Airline: 'Aerolínea' };

function date(value) {
  return value ? new Intl.DateTimeFormat('es-DO', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
    : 'Sin vencimiento';
}

/** Validity and renewal terms in plain words (ADR-0025). */
export function validityLines(document) {
  const validity = document.validity;
  if (!validity) return [];
  return [
    validity.renewalMode === 'Automatic'
      ? `Renovación automática por ${validity.renewalTermMonths} meses: la nueva versión se inicia ${validity.renewalNoticeDays} días antes del fin.`
      : `Renovación manual${validity.renewalTermMonths ? ` por períodos de ${validity.renewalTermMonths} meses` : ''}; aviso ${validity.renewalNoticeDays} días antes.`,
    `Terminación con ${validity.terminationNoticeDays} días de preaviso.${validity.terminationTerms ? ` ${validity.terminationTerms}` : ''}`,
  ];
}

/** By Problem Details code, then status; the server title is never shown (phase 2, block A). */
const problem = error => contractDocumentMessage(error, {
  forbidden: 'Tu acceso no permite consultar, firmar o retirar este contrato.',
  fallback: 'No fue posible completar la operación. Intenta de nuevo.',
});

/** Both parties signed the same content: the version governs and is no longer withdrawn (2-C, 2-N28). */
const signedByBoth = document => document.signatures.some(airline => airline.party === 'Airline' &&
  document.signatures.some(aviam => aviam.party === 'Aviam' && aviam.documentSha256 === airline.documentSha256));

/**
 * Detail of an approved contract version: parties, validity, stations, rates and terms, the
 * printable PDF and the signature of each party over the content hash.
 */
export default function ContractDetailDrawer({ versionId, canSign = false, canManageLifecycle = false, canSetValidity = false,
  canAmend = false, onOpenDrafts, onClose, onSigned }) {
  const [state, setState] = useState({ status: 'loading' });
  const [form, setForm] = useState({ signerName: '', signerTitle: '', accepted: false, signatureImagePng: null });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(null);
  const [revision, setRevision] = useState(0);
  // The withdrawal belongs to the version it was made on: another version opens with neither the dialog nor
  // the result of the previous one.
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawError, setWithdrawError] = useState('');
  const [withdrawal, setWithdrawal] = useState(null);
  const withdrawKeys = useRef(createCommandKeyHolder());
  const withdrawing = withdrawingId !== null && withdrawingId === versionId;
  const withdrawn = withdrawal?.versionId === versionId ? withdrawal.result : null;

  useEffect(() => {
    if (!versionId) return undefined;
    let active = true;
    getContractDocument(versionId)
      .then(document => { if (active) setState({ status: 'success', document }); })
      .catch(failure => { if (active) setState({ status: 'error', message: problem(failure) }); });
    return () => { active = false; };
  }, [versionId, revision]);

  const document = state.status === 'success' ? state.document : null;
  // 2-N10: Contratos withdraws an approved version both parties have not signed, with a reason.
  const withdrawable = Boolean(document) && canManageLifecycle && document.versionStatus === 'Approved' &&
    document.contractStatus !== 'Terminated' && !signedByBoth(document);

  /**
   * Withdraws with the hash on screen. An uncertain result keeps the dialog open so the retry goes with the
   * same key and body; a conflict closes it and re-reads the document.
   */
  async function withdraw() {
    setBusy('withdraw');
    setWithdrawError('');
    const command = { reason: withdrawReason.trim(), expectedDocumentSha256: document.contentSha256 };
    try {
      const result = await withdrawKeys.current.run('withdraw', { versionId, ...command },
        key => withdrawContractVersion(versionId, command, key));
      setWithdrawingId(null);
      setWithdrawReason('');
      setWithdrawal({ versionId, result });
      onSigned?.();
    } catch (failure) {
      if (isConflict(failure)) {
        setWithdrawingId(null);
        setError(problem(failure));
        setRevision(value => value + 1);
      } else setWithdrawError(problem(failure));
    } finally {
      setBusy('');
    }
  }

  async function sign(event) {
    event.preventDefault();
    if (form.signerName.trim().length < 3 || form.signerTitle.trim().length < 2 || !form.accepted || !form.signatureImagePng) {
      setError('Escribe tu nombre completo y cargo, dibuja tu firma y confirma que aceptas el contrato.');
      return;
    }
    setBusy('sign');
    setError('');
    // The same key is reused if the response is lost, so a retry never signs twice.
    requestId.current ??= crypto.randomUUID();
    try {
      const signed = await signContractVersion(versionId, { ...form, documentSha256: document.contentSha256 }, requestId.current);
      requestId.current = null;
      setState({ status: 'success', document: signed });
      onSigned?.();
    } catch (failure) {
      if (failure?.status) requestId.current = null;
      setError(problem(failure));
      if (failure?.status === 409) setRevision(value => value + 1);
    } finally {
      setBusy('');
    }
  }

  return (
    <Drawer open={Boolean(versionId)} onClose={onClose} widthClassName="lg:w-[640px]"
      title={document ? `Contrato ${document.contractCode} · versión ${document.versionNumber}` : 'Detalle de contrato'}
      description={document ? document.airlineName : undefined}
      footer={document && !withdrawn && <ContractPdfButtons versionId={versionId}
        fileName={`contrato-${document.contractCode}-v${document.versionNumber}.pdf`} className="justify-end" />}>
      {withdrawn && <div role="status" className="space-y-2 rounded-lg border border-accent-600/30 p-3 text-sm">
        <p className="font-semibold">Versión retirada.</p>
        <p>Queda rechazada y conserva su aprobación de Finanzas; las firmas de una sola parte quedaron anuladas en el historial.</p>
        {withdrawn.draftVersionId && <p>Se creó un borrador con el mismo contenido: corrígelo en Borradores y envíalo de nuevo a Finanzas.
          {onOpenDrafts && <button type="button" onClick={() => { onClose?.(); onOpenDrafts(); }}
            className="ml-2 font-semibold text-accent-600 underline">Abrir Borradores</button>}</p>}
      </div>}
      {!withdrawn && state.status === 'loading' && <p role="status" className="text-sm">Cargando contrato…</p>}
      {!withdrawn && state.status === 'error' && <div role="alert" className="space-y-2 text-sm"><p>{state.message}</p>
        <button type="button" className="font-semibold text-accent-600 underline" onClick={() => setRevision(value => value + 1)}>Reintentar</button></div>}
      {document && !withdrawn && (
        <div className="space-y-5 text-sm">
          <section>
            <h3 className="font-semibold">Partes y vigencia</h3>
            <p>AVIAM (prestador) y {document.airlineLegalName ?? document.airlineName} ({document.airlineCode}).</p>
            <p>Del {date(document.validFrom)} al {date(document.validTo)} · {document.currencyCode} · versión {document.versionStatus === 'Approved' ? 'aprobada' : 'reemplazada'}</p>
            <p className="text-xs text-text-secondary-light">Estaciones: {document.stations.join('; ') || 'ninguna'}</p>
            {validityLines(document).map(line => <p key={line} className="text-xs">{line}</p>)}
            {!document.validity && document.versionStatus === 'Approved' && document.signatures.length === 0 && (
              <p className="text-xs font-semibold text-status-warning">Pendiente: Contratos debe fijar la vigencia y la renovación antes de las firmas.</p>
            )}
          </section>
          {canSetValidity && document.versionStatus === 'Approved' && document.signatures.length === 0 && (
            <ContractValidityForm key={document.contentSha256} document={document}
              onSaved={saved => { if (saved) setState({ status: 'success', document: saved }); else setRevision(value => value + 1); onSigned?.(); }} />
          )}
          <section>
            <h3 className="font-semibold">Servicios y tarifas</h3>
            {document.rates.length === 0 ? <p>Sin tarifas pactadas.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs">
                <thead><tr className="border-b border-black/10 dark:border-white/10"><th className="py-2">Servicio</th><th>Unidad</th><th className="text-right">Precio</th><th className="text-right">Mínimo</th></tr></thead>
                <tbody>{document.rates.map(rate => <tr key={`${rate.serviceCode}-${rate.billingUnit}`} className="border-b border-black/5 dark:border-white/5">
                  <td className="py-2"><strong>{rate.serviceName}</strong> <span className="text-text-secondary-light">{rate.serviceCode}</span></td>
                  <td>{billingUnitLabel(rate.billingUnit)}</td><td className="text-right tabular-nums">{document.currencyCode} {Number(rate.unitPrice).toFixed(2)}</td>
                  <td className="text-right tabular-nums">{rate.minimumQuantity}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>
          <section>
            <h3 className="font-semibold">Términos</h3>
            <p className="whitespace-pre-line">{document.terms?.trim() || 'Sin términos particulares.'}</p>
          </section>
          <section aria-label="Firmas" className="space-y-2">
            <h3 className="font-semibold">Firmas</h3>
            <p className="break-all font-mono text-[11px] text-text-secondary-light">Huella SHA-256: {document.contentSha256}</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {['Aviam', 'Airline'].map(party => {
                const signature = document.signatures.find(item => item.party === party);
                return <li key={party} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <p className="text-xs font-semibold uppercase text-text-secondary-light">{PARTY[party]}</p>
                  {signature ? <><p>{signature.signerName} · {signature.signerTitle}</p>
                    <p className="text-xs">{new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(signature.signedAt))}
                      {signature.hasDrawnSignature ? ' · firma dibujada' : ''}</p></>
                    : <p className="text-text-secondary-light">{party === 'Aviam' ? 'Contrafirma después de la aerolínea' : 'Pendiente de firma'}</p>}
                </li>;
              })}
            </ul>
            {document.signedOn && document.signatures.length === 2 && (
              <p className="font-semibold">Firmado por ambas partes el {date(document.signedOn)}.</p>
            )}
          </section>
          {canSign && document.signableBy === 'Aviam' && (
            <form onSubmit={sign} noValidate className="space-y-2 rounded-lg border border-accent-600/30 p-3">
              <h3 className="font-semibold">Firmar por AVIAM</h3>
              <label className="grid gap-1">Nombre completo
                <input value={form.signerName} onChange={event => setForm(current => ({ ...current, signerName: event.target.value }))}
                  className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10 dark:bg-surface-dark-card" maxLength={160} /></label>
              <label className="grid gap-1">Cargo
                <input value={form.signerTitle} onChange={event => setForm(current => ({ ...current, signerTitle: event.target.value }))}
                  className="rounded-lg border border-black/10 px-3 py-2 dark:border-white/10 dark:bg-surface-dark-card" maxLength={120} /></label>
              <label className="flex items-start gap-2"><input type="checkbox" checked={form.accepted}
                onChange={event => setForm(current => ({ ...current, accepted: event.target.checked }))} className="mt-1" />
                Acepto este contrato en nombre de AVIAM tal como se muestra (huella SHA-256 indicada arriba).</label>
              <SignaturePad id={`aviam-signature-${versionId}`} label="Firma"
                onChange={signatureImagePng => setForm(current => ({ ...current, signatureImagePng }))} />
              <button type="submit" disabled={busy === 'sign'} className="rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                {busy === 'sign' ? 'Firmando…' : 'Acepto y firmo'}</button>
            </form>
          )}
          {error && <p role="alert" className="text-status-danger">{error}</p>}
          {withdrawable && <section aria-label="Retirar versión" className="space-y-2 rounded-lg border border-status-danger/30 p-3">
            <h3 className="font-semibold">Retirar esta versión</h3>
            <p className="text-xs text-text-secondary-light">Ambas partes todavía no la firmaron. Retirarla la deja rechazada,
              conserva su aprobación y anula en el historial una firma de una sola parte; nada se borra.</p>
            <button type="button" onClick={() => {
              if (withdrawingId !== versionId) setWithdrawReason('');
              setWithdrawingId(versionId); setError(''); setWithdrawError('');
            }}
              className="min-h-[36px] rounded-lg border border-status-danger px-3 text-xs font-semibold text-status-danger">Retirar versión</button>
          </section>}
          <ContractLifecyclePanel key={revision} versionId={versionId} canManage={canManageLifecycle} canAmend={canAmend}
            currentVersion={document.versionStatus === 'Approved'
              ? { versionNumber: document.versionNumber, validFrom: document.validFrom, validTo: document.validTo } : null}
            onOpenDrafts={onOpenDrafts ? () => { onClose?.(); onOpenDrafts(); } : undefined}
            onChanged={() => { setRevision(value => value + 1); onSigned?.(); }} />
        </div>
      )}
      <Modal open={withdrawing} onClose={() => setWithdrawingId(null)}
        title={document ? `Retirar la versión ${document.versionNumber} del contrato ${document.contractCode}` : 'Retirar versión'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setWithdrawingId(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="button" disabled={busy === 'withdraw' || withdrawReason.trim().length < 5} onClick={() => void withdraw()}
            className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'withdraw' ? 'Retirando…' : 'Retirar versión'}</button></div>}>
        <div className="space-y-3 text-sm">
          <p className="text-xs">La versión deja de poder firmarse. Si el contrato nunca se activó, sus condiciones vuelven como borrador para corregirlas.</p>
          <label className="block text-xs font-semibold">Motivo
            <textarea rows={3} maxLength={500} value={withdrawReason} onChange={event => setWithdrawReason(event.target.value)}
              className="mt-1 block w-full rounded-lg border px-3 py-2 dark:bg-surface-dark" /></label>
          {withdrawError && <p role="alert" className="text-status-danger">{withdrawError}</p>}
        </div>
      </Modal>
    </Drawer>
  );
}
