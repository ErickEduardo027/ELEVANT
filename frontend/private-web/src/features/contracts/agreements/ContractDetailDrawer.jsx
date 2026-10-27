import { useEffect, useRef, useState } from 'react';
import Drawer from '../../../components/Drawer';
import { downloadContractDocument, getContractDocument, signContractVersion } from '../../../services/commercialGovernanceApi';

const PARTY = { Aviam: 'AVIAM', Airline: 'Aerolínea' };

function date(value) {
  return value ? new Intl.DateTimeFormat('es-DO', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
    : 'Sin vencimiento';
}

function problem(error) {
  if (error?.status === 403) return 'Tu acceso no permite consultar o firmar este contrato.';
  if (error?.status === 404) return 'Esta versión ya no tiene documento disponible.';
  if (error?.status === 409) return 'El contrato cambió o ya fue firmado; se volvió a cargar. Revísalo antes de firmar.';
  return 'No fue posible completar la operación. Intenta de nuevo.';
}

/**
 * Detail of an approved contract version: parties, validity, stations, rates and terms, the
 * printable PDF and the signature of each party over the content hash.
 */
export default function ContractDetailDrawer({ versionId, canSign = false, onClose, onSigned }) {
  const [state, setState] = useState({ status: 'loading' });
  const [form, setForm] = useState({ signerName: '', signerTitle: '', accepted: false });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!versionId) return undefined;
    let active = true;
    getContractDocument(versionId)
      .then(document => { if (active) setState({ status: 'success', document }); })
      .catch(failure => { if (active) setState({ status: 'error', message: problem(failure) }); });
    return () => { active = false; };
  }, [versionId, revision]);

  const document = state.status === 'success' ? state.document : null;

  async function download() {
    setBusy('pdf');
    setError('');
    try {
      await downloadContractDocument(versionId, `contrato-${document.contractCode}-v${document.versionNumber}.pdf`);
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy('');
    }
  }

  async function sign(event) {
    event.preventDefault();
    if (form.signerName.trim().length < 3 || form.signerTitle.trim().length < 2 || !form.accepted) {
      setError('Escribe tu nombre completo y cargo, y confirma que aceptas el contrato.');
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
      footer={document && <button type="button" onClick={() => void download()} disabled={busy === 'pdf'}
        className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy === 'pdf' ? 'Generando PDF…' : 'Descargar PDF'}</button>}>
      {state.status === 'loading' && <p role="status" className="text-sm">Cargando contrato…</p>}
      {state.status === 'error' && <div role="alert" className="space-y-2 text-sm"><p>{state.message}</p>
        <button type="button" className="font-semibold text-accent-600 underline" onClick={() => setRevision(value => value + 1)}>Reintentar</button></div>}
      {document && (
        <div className="space-y-5 text-sm">
          <section>
            <h3 className="font-semibold">Partes y vigencia</h3>
            <p>AVIAM (prestador) y {document.airlineLegalName ?? document.airlineName} ({document.airlineCode}).</p>
            <p>Del {date(document.validFrom)} al {date(document.validTo)} · {document.currencyCode} · versión {document.versionStatus === 'Approved' ? 'aprobada' : 'reemplazada'}</p>
            <p className="text-xs text-text-secondary-light">Estaciones: {document.stations.join('; ') || 'ninguna'}</p>
          </section>
          <section>
            <h3 className="font-semibold">Servicios y tarifas</h3>
            {document.rates.length === 0 ? <p>Sin tarifas pactadas.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-xs">
                <thead><tr className="border-b border-black/10 dark:border-white/10"><th className="py-2">Servicio</th><th>Unidad</th><th className="text-right">Precio</th><th className="text-right">Mínimo</th></tr></thead>
                <tbody>{document.rates.map(rate => <tr key={`${rate.serviceCode}-${rate.billingUnit}`} className="border-b border-black/5 dark:border-white/5">
                  <td className="py-2"><strong>{rate.serviceName}</strong> <span className="text-text-secondary-light">{rate.serviceCode}</span></td>
                  <td>{rate.billingUnit}</td><td className="text-right tabular-nums">{document.currencyCode} {Number(rate.unitPrice).toFixed(2)}</td>
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
                    <p className="text-xs">{new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(signature.signedAt))}</p></>
                    : <p className="text-text-secondary-light">Pendiente de firma</p>}
                </li>;
              })}
            </ul>
            {document.signedOn && <p className="font-semibold">Firmado por ambas partes el {date(document.signedOn)}.</p>}
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
              <button type="submit" disabled={busy === 'sign'} className="rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                {busy === 'sign' ? 'Firmando…' : 'Acepto y firmo'}</button>
            </form>
          )}
          {error && <p role="alert" className="text-status-danger">{error}</p>}
        </div>
      )}
    </Drawer>
  );
}
