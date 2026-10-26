import { useCallback, useEffect, useRef, useState } from 'react';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { readSession } from '../../auth/authService';
import { getCommercialRequests } from '../../../services/commercialGovernanceApi';
import { listContractSigning, listAviamSigners, setContractSigner,
  previewContractPdf, getContractDraftPdf, issueContract, acceptAviamContract,
  getSignedContractPdf, getContractAuditPdf } from '../../../services/contractSigningService';

const STATUS = {
  AwaitingEmission: 'Pendiente de emisión', Prepared: 'PDF preparado',
  Issued: 'Firma AVIAM pendiente', AwaitingAirline: 'Firma aerolínea pendiente',
  Finalizing: 'Validando evidencia', Formalized: 'Formalizado',
  Incident: 'Incidencia', Cancelled: 'Cancelado', Legacy: 'Contrato legado',
};

async function openPdf(load) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const blob = await load();
    const url = URL.createObjectURL(blob);
    if (!tab) { URL.revokeObjectURL(url); throw new Error('Popup blocked'); }
    tab.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (error) { tab?.close(); throw error; }
}

export default function ContractSigningPage({ canPreview, canIssue }) {
  const [items, setItems] = useState([]);
  const [signers, setSigners] = useState([]);
  const [origins, setOrigins] = useState({});
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [busyVersion, setBusyVersion] = useState(null);
  const [reviewed, setReviewed] = useState({});
  const acceptanceRequestIds = useRef({});
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useCommercialRevalidation(refresh);

  useEffect(() => {
    let active = true;
    setState('loading');
    Promise.all([listContractSigning(), listAviamSigners(), getCommercialRequests().catch(() => [])]).then(([contracts, eligible, requests]) => {
      if (!active) return;
      setItems(contracts); setSigners(eligible);
      setOrigins(Object.fromEntries(requests.filter(request => request.contractId).map(request => [request.contractId, request])));
      setState('ready');
    }).catch(error => { if (active) setState(error?.status === 403 ? 'forbidden' : 'error'); });
    return () => { active = false; };
  }, [revision]);

  async function perform(action, success, versionId = null) {
    setMessage('');
    setBusyVersion(versionId);
    try { await action(); setMessage(success); refresh(); }
    catch (error) { setMessage(error?.status === 503
      ? 'La emisión no está configurada en este entorno.'
      : 'No se pudo completar la acción. Revise el estado y vuelva a intentarlo.'); }
    finally { setBusyVersion(null); }
  }

  return <div className="mx-auto max-w-[1200px] space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión contractual</p>
      <h1 className="mt-1 text-2xl font-bold">Emisión y aceptación</h1>
      <p className="mt-1 text-sm text-text-secondary-light">AVIAM acepta primero y la aerolínea después. La aprobación financiera por sí sola no habilita servicios.</p></header>
    <button type="button" className="rounded-lg border px-4 py-2" onClick={refresh}>Recargar estados</button>
    {message && <p role="status" className="rounded-lg border p-3">{message}</p>}
    {state === 'loading' && <p role="status">Cargando expedientes…</p>}
    {state === 'forbidden' && <p role="alert">No tiene permiso para consultar expedientes de firma.</p>}
    {state === 'error' && <p role="alert">No se pudieron cargar los expedientes. Intente de nuevo.</p>}
    {state === 'ready' && items.length === 0 && <p>No hay versiones contractuales nuevas.</p>}
    {state === 'ready' && <div className="space-y-4">{items.map(item =>
      <article key={item.versionId} className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-surface-dark-card">
        <div className="flex flex-wrap justify-between gap-3"><div><p className="font-mono text-xs text-accent-600">{item.contractCode}</p>
          <h2 className="font-semibold">{item.airlineName}</h2></div>
          <strong>{STATUS[item.signingStatus] ?? item.signingStatus}</strong></div>
        <p className="mt-2 text-sm">Versión: {item.versionStatus} · AVIAM: {item.aviamSignerEmail ?? 'por designar'} · Aerolínea: {item.airlineSignerEmail ?? 'por verificar'}</p>
        {origins[item.contractId] && <div className="mt-3 rounded-lg bg-black/[.03] p-3 text-sm dark:bg-white/[.04]">
          <p>Solicitud de origen: <strong>{origins[item.contractId].reference}</strong></p>
          <p>Servicios: {origins[item.contractId].services?.map(service => service.name).join(', ') || 'Por confirmar'}</p>
          <p>Paquetes: {origins[item.contractId].packages?.map(pack => `${pack.name} (v${pack.versionNumber})`).join(', ') || 'Ninguno'}</p>
        </div>}
        {item.issuedAt && <p className="text-xs">Emitido: {new Date(item.issuedAt).toLocaleString('es-DO')}</p>}
        {item.aviamAcceptedAt && <p className="text-xs">Aceptación AVIAM: {new Date(item.aviamAcceptedAt).toLocaleString('es-DO')}</p>}
        {item.airlineAcceptedAt && <p className="text-xs">Aceptación aerolínea: {new Date(item.airlineAcceptedAt).toLocaleString('es-DO')}</p>}
        {item.formalizedAt && <p className="text-xs">Formalizado: {new Date(item.formalizedAt).toLocaleString('es-DO')}</p>}
        {item.signingStatus === 'Incident' && <p role="alert" className="mt-2 text-sm text-red-700">Incidencia de firma o evidencia. Revise con el operador antes de reintentar.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canIssue && item.versionStatus !== 'Approved' && !item.issuedAt && <label className="text-sm">Firmante AVIAM: <select disabled={busyVersion === item.versionId} className="ml-2 rounded border px-2 py-1" value={item.aviamSignerAccountId ?? ''}
            onChange={event => { if (event.target.value) void perform(() => setContractSigner(item.versionId, event.target.value), 'Firmante AVIAM designado.'); }}>
            <option value="">Seleccionar</option>{signers.map(signer => <option key={signer.accountId} value={signer.accountId}>{signer.name} · {signer.email}</option>)}
          </select></label>}
          {canPreview && item.versionStatus === 'Approved' && !item.issuedAt && <button type="button" disabled={busyVersion === item.versionId} className="rounded border px-3 py-2 text-sm" onClick={() => void perform(() => openPdf(() => previewContractPdf(item.versionId)), 'Previsualización abierta.', item.versionId)}>Preparar y revisar PDF</button>}
          {canPreview && item.draftSha256 && <button type="button" disabled={busyVersion === item.versionId} className="rounded border px-3 py-2 text-sm" onClick={() => void perform(async () => {
            await openPdf(() => getContractDraftPdf(item.versionId));
            setReviewed(current => ({ ...current, [item.versionId]: item.draftSha256 }));
          }, 'Versión contractual abierta.', item.versionId)}>Revisar contrato</button>}
          {canIssue && item.versionStatus === 'Approved' && !item.issuedAt && <button type="button" disabled={busyVersion === item.versionId || !item.draftSha256} className="rounded bg-accent-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => void perform(() => issueContract(item.versionId), 'Expediente emitido para aceptación.', item.versionId)}>Emitir contrato</button>}
          {item.signingMethod === 'AcademicLocal' && item.signingStatus === 'Issued' && item.aviamSignerAccountId === readSession()?.accountId && item.draftSha256 &&
            <button type="button" disabled={busyVersion === item.versionId || reviewed[item.versionId] !== item.draftSha256} className="rounded bg-accent-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => void perform(async () => {
              if (acceptanceRequestIds.current[item.versionId]?.sha256 !== item.draftSha256) {
                acceptanceRequestIds.current[item.versionId] = { sha256: item.draftSha256, id: crypto.randomUUID() };
              }
              await acceptAviamContract(item.versionId, item.draftSha256, acceptanceRequestIds.current[item.versionId].id);
              delete acceptanceRequestIds.current[item.versionId];
            }, 'Aceptación AVIAM registrada.', item.versionId)}>Confirmar aceptación AVIAM</button>}
          {item.signingStatus === 'Formalized' && <><button type="button" disabled={busyVersion === item.versionId} className="rounded border px-3 py-2 text-sm" onClick={() => void perform(() => openPdf(() => getSignedContractPdf(item.versionId)), 'Contrato abierto.', item.versionId)}>Ver, descargar o imprimir</button>
            <button type="button" disabled={busyVersion === item.versionId} className="rounded border px-3 py-2 text-sm" onClick={() => void perform(() => openPdf(() => getContractAuditPdf(item.versionId)), 'Evidencia abierta.', item.versionId)}>Ver evidencia</button></>}
        </div>
        {item.draftSha256 && <p className="mt-3 break-all font-mono text-xs">SHA-256 de la versión revisada: {item.draftSha256}</p>}
        {item.signedSha256 && <p className="mt-3 break-all font-mono text-xs">SHA-256 del PDF: {item.signedSha256}</p>}
        {item.auditSha256 && <p className="break-all font-mono text-xs">SHA-256 de auditoría: {item.auditSha256}</p>}
      </article>)}</div>}
  </div>;
}
