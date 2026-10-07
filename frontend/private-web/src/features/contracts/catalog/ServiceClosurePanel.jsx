import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrivateMediaUrl } from '../../../hooks/usePrivateMediaUrl';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { decideServiceClosure, getPublishedCommercialServices, getServiceClosures,
  reopenService, requestServiceClosure, commercialMediaUrl } from '../../../services/commercialGovernanceApi';

const labels = { Pending: 'Pendiente', Approved: 'Clausura aprobada', Denied: 'Denegada' };
const MIN_REASON = 10;

function ServiceImage({ url, name }) {
  const src = usePrivateMediaUrl(url);
  return src ? <img className="h-44 w-full object-cover" src={src} alt={name} /> :
    <div className="grid h-44 place-items-center bg-surface-dark text-sm text-white">AVIAM · {name}</div>;
}

function ServiceVideo({ url, name }) {
  return <video controls playsInline preload="none" className="w-full rounded-lg"
    src={commercialMediaUrl(url)} aria-label={`Video de ${name}`} />;
}

export default function ServiceClosurePanel({ mode = 'occ', canRequest = mode === 'occ',
  canDecide = mode === 'contracts', canReopen = mode === 'contracts' }) {
  const [catalog, setCatalog] = useState([]);
  const [history, setHistory] = useState({ items: [], pendingCount: 0, hasMore: false });
  const [status, setStatus] = useState('loading');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestId = useRef(null);

  const reload = useCallback(async () => {
    try {
      const [requests, published] = await Promise.all([
        getServiceClosures(filter || null, page),
        mode === 'occ' || canRequest ? getPublishedCommercialServices() : Promise.resolve(null),
      ]);
      setHistory(requests);
      if (published) setCatalog(published.services);
      setStatus('ready'); setError('');
    } catch (failure) {
      if (failure.status === 403) {
        setHistory({ items: [], pendingCount: 0, pendingServiceIds: [], hasMore: false });
        setCatalog([]);
      }
      setStatus('error'); setError(failure.message);
    }
  }, [canRequest, filter, mode, page]);

  useEffect(() => { void reload(); }, [reload]);
  useCommercialRevalidation(reload);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('service_closures') || resources.includes('commercial_catalog'))
        void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);

  const open = (action, item) => {
    setDialog({ action, item }); setReason(''); setError(''); setNotice('');
    if (action === 'request') requestId.current = crypto.randomUUID();
  };
  const close = () => { if (!busy) { setDialog(null); setReason(''); requestId.current = null; } };
  const submit = async event => {
    event.preventDefault();
    const value = reason.trim();
    if (dialog.action !== 'approve' && (value.length < MIN_REASON || value.length > 1000)) {
      setError('Escriba un motivo de 10 a 1000 caracteres.'); return;
    }
    setBusy(true); setError('');
    try {
      if (dialog.action === 'request')
        await requestServiceClosure(requestId.current, dialog.item.id, value);
      else if (dialog.action === 'reopen')
        await reopenService(dialog.item.serviceId, value, dialog.item.serviceVersion);
      else
        await decideServiceClosure(dialog.item.id, dialog.action === 'approve',
          value || null, dialog.item.version);
      setNotice(dialog.action === 'request' ? 'Solicitud de clausura enviada a Contratos.' :
        dialog.action === 'approve' ? 'Clausura aprobada. El servicio salió del catálogo público.' :
          dialog.action === 'reopen' ? 'Servicio republicado con motivo registrado.' :
            'Solicitud denegada. El servicio continúa publicado.');
      setDialog(null); requestId.current = null;
      await reload();
    } catch (failure) {
      setError(failure.status === 409 ? 'El estado cambió. Actualice el listado y reintente.' : failure.message);
    } finally { setBusy(false); }
  };

  const pendingServiceIds = new Set(history.pendingServiceIds ?? []);
  return <section className="space-y-5" aria-label="Clausuras de servicios">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">AVIAM / SERVICIOS</p>
        <h2 className="mt-1 text-xl font-bold">{mode === 'occ' ? 'Disponibilidad de servicios' : 'Solicitudes de clausura'}</h2>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          {mode === 'occ' ? 'Revise la oferta actual y notifique a Contratos cuando no pueda ejecutarse un servicio.' :
            'Decida las solicitudes de OCC. La aprobación suspende la comercialización global sin alterar contratos ni operaciones existentes.'}
        </p></div>
      <button type="button" onClick={() => void reload()} className="min-h-11 rounded-lg border border-accent-600 px-4 text-sm font-semibold text-accent-600">Actualizar</button>
    </header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && !dialog && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    {status === 'loading' && <p role="status">Cargando servicios…</p>}
    {(mode === 'occ' || canRequest) && status === 'ready' && <div className="flex snap-x gap-4 overflow-x-auto pb-3" aria-label="Servicios publicados">
      {catalog.map(service => <article key={service.id} className="w-[min(290px,80vw)] shrink-0 snap-start overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-surface-dark-card">
        <ServiceImage url={service.imageUrl} name={service.name} />
        <div className="space-y-2 p-4"><h3 className="font-bold">{service.name}</h3><p className="min-h-14 text-sm text-text-secondary-light">{service.description}</p>
          {service.videoUrl && <ServiceVideo url={service.videoUrl} name={service.name} />}
          {canRequest && <button type="button" disabled={pendingServiceIds.has(service.id)} onClick={() => open('request', service)}
            className="min-h-11 w-full rounded-lg border border-accent-600 px-3 text-sm font-semibold text-accent-600 disabled:opacity-50">
            {pendingServiceIds.has(service.id) ? 'Clausura pendiente' : 'Notificar clausura'}</button>}</div>
      </article>)}
      {catalog.length === 0 && <p className="rounded-xl bg-white p-5">No hay servicios publicados.</p>}
    </div>}
    <section className="space-y-3 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Historial compartido · {history.pendingCount} pendientes</h3>
        <label className="text-sm">Estado <select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} className="ml-2 rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Todos</option><option value="Pending">Pendientes</option><option value="Approved">Aprobadas</option><option value="Denied">Denegadas</option>
        </select></label></div>
      {status === 'ready' && history.items.length === 0 && <p className="text-sm">Todavía no hay solicitudes de clausura.</p>}
      {history.items.map(item => <article key={item.id} className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{item.serviceName}</strong><p className="text-xs text-text-secondary-light">{labels[item.status]} · {new Date(item.requestedAt).toLocaleString('es-DO')}</p></div>
          {mode === 'contracts' && <div className="flex flex-wrap gap-2">
            {item.status === 'Pending' && canDecide && <><button type="button" onClick={() => open('approve', item)} className="min-h-11 rounded-lg bg-accent-600 px-3 text-sm font-semibold text-white">Aprobar clausura</button>
              <button type="button" onClick={() => open('deny', item)} className="min-h-11 rounded-lg border px-3 text-sm">Denegar</button></>}
            {item.status === 'Approved' && !item.reopenedAt && !item.isCurrentlyPublic && canReopen && <button type="button" onClick={() => open('reopen', item)} className="min-h-11 rounded-lg border border-accent-600 px-3 text-sm text-accent-600">Republicar</button>}
          </div>}</div>
        <p className="mt-2 text-sm"><span className="font-semibold">Motivo OCC:</span> {item.reason}</p>
        {item.decisionReason && <p className="mt-1 text-sm"><span className="font-semibold">Decisión:</span> {item.decisionReason}</p>}
        {item.reopenReason && <p className="mt-1 text-sm"><span className="font-semibold">Reapertura:</span> {item.reopenReason}</p>}
      </article>)}
      <div className="flex gap-3">{page > 1 && <button type="button" onClick={() => setPage(value => value - 1)} className="text-sm text-accent-600">Anterior</button>}
        {history.hasMore && <button type="button" onClick={() => setPage(value => value + 1)} className="text-sm text-accent-600">Siguiente</button>}</div>
    </section>
    {dialog && <div role="presentation" className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4">
      <form role="dialog" aria-modal="true" aria-label="Confirmar acción de servicio" onSubmit={submit} className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-surface-dark-card sm:p-6">
        <h3 className="text-lg font-bold">{dialog.action === 'request' ? 'Notificar clausura' : dialog.action === 'approve' ? 'Aprobar clausura' : dialog.action === 'deny' ? 'Denegar clausura' : 'Republicar servicio'}</h3>
        <p className="text-sm">{dialog.item.name ?? dialog.item.serviceName}</p>
        <p className="text-sm text-text-secondary-light">{dialog.action === 'approve' ? 'El servicio dejará de aparecer para nuevas solicitudes de aerolíneas.' : 'La decisión quedará registrada y será visible para OCC y Contratos.'}</p>
        <label className="block text-sm font-semibold">Motivo {dialog.action === 'approve' ? '(opcional)' : '(obligatorio)'}
          <textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} rows={4} className="mt-1 w-full rounded-lg border p-3 dark:bg-surface-dark" /></label>
        {error && <p role="alert" className="text-sm text-status-danger">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" onClick={close} disabled={busy} className="min-h-11 rounded-lg border px-4 text-sm">Cancelar</button>
          <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Confirmar'}</button></div>
      </form></div>}
  </section>;
}
