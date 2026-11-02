import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import Modal from '../../../components/Modal';
import StatusBadge from '../../../components/StatusBadge';
import { getAirlinePermitsForContracts, openPrivateDocument, reviewAirlinePermit } from '../../../services/commercialGovernanceApi';
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
};
const FILTERS = [['Submitted', 'Por verificar'], ['Verified', 'Verificados'], ['Rejected', 'Rechazados'], ['', 'Todos']];
const date = value => new Date(`${value}T00:00:00`).toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * Contratos verifies the permits each airline submits from its portal (ADR-0024). A verified,
 * current operating permit is one of the conditions to activate a signed contract.
 */
export default function AirlinePermitsPage({ canVerify }) {
  const [filter, setFilter] = useState('Submitted');
  const [state, setState] = useState({ status: 'loading', permits: [], error: '' });
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { setState({ status: 'ready', permits: await getAirlinePermitsForContracts(filter), error: '' }); }
    catch (failure) { setState({ status: failure.status === 403 ? 'forbidden' : 'error', permits: [], error: failure.message }); }
  }, [filter]);
  useEffect(() => { setState(current => ({ ...current, status: 'loading' })); void load(); }, [load]);

  async function review(permit, verified, reason) {
    setBusy(permit.id); setNotice('');
    try {
      await reviewAirlinePermit(permit.id, verified, reason, permit.version);
      setNotice(verified ? `Permiso ${permit.number} de ${permit.airline} verificado. Si tenía un contrato firmado, ya quedó activo.`
        : `Permiso ${permit.number} rechazado; la aerolínea verá el motivo en su portal.`);
      setRejecting(null); setNote('');
      await load();
    } catch (failure) {
      setNotice(failure.status === 409 ? 'El permiso cambió; se actualizó la lista.' : failure.code === 'permit_expired'
        ? 'No se puede verificar un permiso vencido.' : failure.message);
      if (failure.status === 409) await load();
    } finally { setBusy(''); }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Permisos de aerolíneas</h1>
        <p className="mt-1 text-sm text-text-secondary-light">Un contrato firmado se activa cuando la aerolínea tiene un permiso de operación verificado y vigente; si vence, el contrato se suspende hasta que se verifique uno nuevo.</p>
      </header>
      <div role="tablist" aria-label="Estado de revisión" className="flex flex-wrap gap-2">
        {FILTERS.map(([value, label]) => (
          <button key={value || 'all'} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}
            className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold ${filter === value ? 'border-accent-600 bg-accent-600 text-white' : 'border-black/10 dark:border-white/10'}`}>{label}</button>
        ))}
      </div>
      {notice && <div role="status" className="rounded-lg border border-accent-600/30 bg-accent-600/10 p-3 text-sm">{notice}</div>}
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
              {permit.reviewNote && <p className="mt-2 text-xs text-text-secondary-light">Nota: {permit.reviewNote}</p>}
              {permit.documentUrl && <p className="mt-2 text-xs"><button type="button" onClick={() => openPrivateDocument(permit.documentUrl).catch(failure => setNotice(failure.message))} className="font-semibold text-accent-600 underline">Abrir documento adjunto</button></p>}
              {canVerify && permit.review === 'Submitted' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy === permit.id || permit.validity === 'Expired'} onClick={() => void review(permit, true, '')}
                    className="min-h-[36px] rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white disabled:opacity-50">Verificar</button>
                  <button type="button" disabled={busy === permit.id} onClick={() => { setRejecting(permit); setNote(''); }}
                    className="min-h-[36px] rounded-lg border border-status-danger px-3 text-xs font-semibold text-status-danger">Rechazar</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={Boolean(rejecting)} onClose={() => setRejecting(null)} title={`Rechazar permiso ${rejecting?.number ?? ''}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setRejecting(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="button" disabled={note.trim().length < 5 || busy === rejecting?.id} onClick={() => void review(rejecting, false, note.trim())} className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Rechazar</button></div>}>
        <label className="block text-sm font-semibold">Motivo (la aerolínea lo verá)
          <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={3}
            className="mt-1 block w-full rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" /></label>
      </Modal>
    </div>
  );
}
