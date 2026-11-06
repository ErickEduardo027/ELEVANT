import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import { getAirlinePermitsForContracts, openPrivateDocument, reviewAirlinePermit, revokeAirlinePermit } from '../../../services/commercialGovernanceApi';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { airlinePermitMessage } from '../../../services/commercialProblems';
import { isConflict, isForbidden } from '../../../services/problemMessages';
import { ShieldCheckIcon } from '../../shell/components/icons';

export const PERMIT_KINDS = {
  OperatingPermit: 'Permiso de operación (JAC)',
  AirOperatorCertificate: 'Certificado de explotador (IDAC / AOC)',
  Insurance: 'Póliza de seguro',
  Other: 'Otro documento',
};
export const PERMIT_VALIDITY = {
  Current: { label: 'Vigente', tone: 'success' },
  Expiring: { label: 'Vence en 30 días o menos', tone: 'warning' },
  Expired: { label: 'Vencido', tone: 'danger' },
};
const REVIEW = {
  Submitted: { label: 'Por verificar', tone: 'warning' },
  Verified: { label: 'Verificado', tone: 'success' },
  Rejected: { label: 'Rechazado', tone: 'danger' },
  // 2-N09: a revoked permit no longer counts; its original verification is kept.
  Revoked: { label: 'Verificación revocada', tone: 'danger' },
};
const FILTERS = [['Submitted', 'Por verificar'], ['Verified', 'Verificados'], ['Rejected', 'Rechazados'],
  ['Revoked', 'Revocados'], ['', 'Todos']];
const DECISIONS = {
  reject: { title: 'Rechazar permiso', field: 'Motivo del rechazo (la aerolínea lo verá)', confirm: 'Rechazar' },
  revoke: { title: 'Revocar la verificación del permiso', field: 'Motivo de la revocación (la aerolínea lo verá)',
    confirm: 'Revocar verificación' },
};
const date = value => new Date(`${value}T00:00:00`).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
const stamp = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const codes = contracts => contracts.map(item => item.contractCode).join(', ');

/**
 * What a review or a revocation really did, from the answer of the server (2-N30): the contracts it activated,
 * resumed or suspended, never a fixed promise. Emails are only queued, never claimed as sent.
 */
export function decisionNotice(permit, action) {
  const subject = `Permiso ${permit.number} de ${permit.airline}`;
  const active = permit.contracts.filter(item => item.status === 'Active');
  const suspended = permit.contracts.filter(item => item.status === 'Suspended');
  if (action === 'reject')
    return `${subject} rechazado. La aerolínea verá el motivo en su portal y el correo con la nota quedó en cola.`;
  if (action === 'revoke')
    return `Se revocó la verificación del permiso ${permit.number} de ${permit.airline}. ` + (suspended.length
      ? `${suspended.length === 1 ? 'Quedó suspendido el contrato' : 'Quedaron suspendidos los contratos'} ${codes(suspended)} ` +
        'hasta que se verifique un permiso de operación válido. '
      : 'Ningún contrato cambió de estado. ') + 'El aviso a la aerolínea quedó en cola.';
  if (active.length)
    return `${subject} verificado. ${active.length === 1 ? `El contrato ${codes(active)} ya quedó activo.`
      : `Los contratos ${codes(active)} ya quedaron activos.`}`;
  return permit.kind === 'OperatingPermit'
    ? `${subject} verificado. Ningún contrato cambió de estado.`
    : `${subject} verificado. Este documento no activa contratos: solo el permiso de operación (JAC) lo hace.`;
}

/**
 * Contratos verifies the permits each airline submits from its portal (ADR-0024) and revokes a verification made
 * by mistake (2-N09). A verified, current operating permit is one of the conditions to activate a signed contract.
 * Every command carries the intent's Idempotency-Key and the version on screen.
 */
export default function AirlinePermitsPage({ canVerify }) {
  const [filter, setFilter] = useState('Submitted');
  const [state, setState] = useState({ status: 'loading', permits: [], error: '' });
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const keys = useRef(createCommandKeyHolder());

  const load = useCallback(async () => {
    try { setState({ status: 'ready', permits: await getAirlinePermitsForContracts(filter), error: '' }); }
    catch (failure) {
      setState({ status: isForbidden(failure) ? 'forbidden' : 'error', permits: [],
        error: airlinePermitMessage(failure, { fallback: 'No se pudieron cargar los permisos. Intenta de nuevo.' }) });
    }
  }, [filter]);
  useEffect(() => { setState(current => ({ ...current, status: 'loading' })); void load(); }, [load]);

  async function decide(permit, action, text = '') {
    setBusy(permit.id); setNotice(null);
    const command = action === 'revoke' ? { reason: text, expectedVersion: permit.version }
      : { verified: action === 'verify', note: text || null, expectedVersion: permit.version };
    try {
      // The same key goes with a retry of the same intent after an uncertain result.
      const result = await keys.current.run(action, { permitId: permit.id, ...command }, key => action === 'revoke'
        ? revokeAirlinePermit(permit.id, command, key) : reviewAirlinePermit(permit.id, command, key));
      setNotice({ kind: 'ok', text: decisionNotice(result, action) });
      setDecision(null); setReason('');
      await load();
    } catch (failure) {
      setNotice({ kind: 'error', text: airlinePermitMessage(failure) });
      if (isConflict(failure) || failure?.status === 404) { setDecision(null); await load(); }
    } finally { setBusy(''); }
  }

  const meta = decision ? DECISIONS[decision.action] : null;
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Permisos de aerolíneas</h1>
        <p className="mt-1 text-sm text-text-secondary-light">Un contrato firmado se activa cuando la aerolínea tiene un permiso de operación verificado y vigente; si vence o se revoca su verificación, el contrato se suspende hasta que se verifique uno nuevo.</p>
      </header>
      <div role="tablist" aria-label="Estado de revisión" className="flex flex-wrap gap-2">
        {FILTERS.map(([value, label]) => (
          <button key={value || 'all'} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}
            className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${filter === value ? 'border-accent-600 bg-accent-600 text-white' : 'border-black/10 dark:border-white/10'}`}>{label}</button>
        ))}
      </div>
      {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className="rounded-lg border border-accent-600/30 bg-accent-600/10 p-3 text-sm">{notice.text}</div>}
      {state.status === 'loading' && <p role="status" className="text-sm">Cargando permisos…</p>}
      {state.status === 'forbidden' && <p role="alert" className="text-sm">No tienes acceso a los permisos de aerolíneas.</p>}
      {state.status === 'error' && <div role="alert" className="text-sm"><p>{state.error}</p><button type="button" onClick={() => void load()} className="mt-2 font-semibold text-accent-600 underline">Reintentar</button></div>}
      {state.status === 'ready' && state.permits.length === 0 && <EmptyState icon={ShieldCheckIcon} title="Sin permisos en esta vista" description="Los permisos que envíen las aerolíneas desde su portal aparecerán aquí." />}
      {state.status === 'ready' && state.permits.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {state.permits.map(permit => (
            <li key={permit.id} className="rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><strong>{permit.airline}</strong><p className="text-xs text-text-secondary-light">{PERMIT_KINDS[permit.kind] ?? permit.kind}</p></div>
                <div className="flex flex-wrap gap-1"><StatusBadge tone={REVIEW[permit.review]?.tone} label={REVIEW[permit.review]?.label ?? permit.review} /><StatusBadge tone={PERMIT_VALIDITY[permit.validity]?.tone} label={PERMIT_VALIDITY[permit.validity]?.label ?? permit.validity} /></div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-text-secondary-light">Número</dt><dd className="font-mono">{permit.number}</dd>
                <dt className="text-text-secondary-light">Emisor</dt><dd>{permit.issuer}</dd>
                <dt className="text-text-secondary-light">Emitido</dt><dd>{date(permit.issuedOn)}</dd>
                <dt className="text-text-secondary-light">Vence</dt><dd>{date(permit.expiresOn)}</dd>
              </dl>
              {permit.reviewNote && <p className="mt-2 text-xs text-text-secondary-light">{permit.review === 'Rejected' ? 'Motivo del rechazo' : 'Nota de la verificación'}: {permit.reviewNote}</p>}
              {permit.review === 'Revoked' && permit.revokedAt && <p className="mt-2 text-xs text-status-danger">Verificación revocada el {stamp(permit.revokedAt)}{permit.revocationReason ? `. Motivo: ${permit.revocationReason}` : '.'}</p>}
              {permit.documentUrl && <p className="mt-2 text-xs"><button type="button" onClick={() => openPrivateDocument(permit.documentUrl).catch(() => setNotice({ kind: 'error', text: 'No se pudo abrir el documento adjunto.' }))} className="font-semibold text-accent-600 underline">Abrir documento adjunto</button></p>}
              {canVerify && permit.review === 'Submitted' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy === permit.id || permit.validity === 'Expired'} onClick={() => void decide(permit, 'verify')}
                    className="min-h-[36px] rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white disabled:opacity-50">Verificar</button>
                  <button type="button" disabled={busy === permit.id} onClick={() => { setDecision({ permit, action: 'reject' }); setReason(''); }}
                    className="min-h-[36px] rounded-lg border border-status-danger px-3 text-xs font-semibold text-status-danger">Rechazar</button>
                </div>
              )}
              {canVerify && permit.review === 'Verified' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy === permit.id} onClick={() => { setDecision({ permit, action: 'revoke' }); setReason(''); }}
                    className="min-h-[36px] rounded-lg border border-status-danger px-3 text-xs font-semibold text-status-danger">Revocar verificación</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={Boolean(decision)} onClose={() => setDecision(null)} title={`${meta?.title ?? ''} ${decision?.permit.number ?? ''}`.trim()}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDecision(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="button" disabled={reason.trim().length < 5 || busy === decision?.permit.id}
            onClick={() => void decide(decision.permit, decision.action, reason.trim())}
            className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{meta?.confirm}</button></div>}>
        {decision?.action === 'revoke' && <p className="mb-2 text-sm">Si la aerolínea no tiene otro permiso de operación verificado y vigente, sus contratos activos se suspenden ahora y se reanudan al verificar uno válido.</p>}
        <label className="block text-sm font-semibold">{meta?.field}
          <textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3}
            className="mt-1 block w-full rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" /></label>
      </Modal>
    </div>
  );
}
