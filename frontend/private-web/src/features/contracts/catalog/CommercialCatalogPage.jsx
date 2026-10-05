import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../../components/Drawer';
import ConfirmDialog from '../../../components/ConfirmDialog';
import FileDropField from '../../../components/FileDropField';
import { usePrivateMediaUrl } from '../../../hooks/usePrivateMediaUrl';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { deleteManagedService, getManagedServices, saveManagedService, uploadCommercialMedia } from '../../../services/commercialGovernanceApi';
import ServiceClosurePanel from './ServiceClosurePanel';

const empty = { code: '', name: '', description: '', billingUnit: 'operación', imageUrl: '', videoUrl: '', displayOrder: 1, isPublic: true, isActive: true, version: null };

export default function CommercialCatalogPage({ canCreate = true, canEdit = true,
  canRetire = true, canSeeClosures = true }) {
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [initial, setInitial] = useState(empty);
  const [image, setImage] = useState(null);
  const [video, setVideo] = useState(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [pendingRetire, setPendingRetire] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('catalog');
  const dirty = image !== null || video !== null || JSON.stringify(form) !== JSON.stringify(initial);

  const reload = useCallback(async () => {
    try { setServices(await getManagedServices()); setStatus('ready'); setError(''); }
    catch (failure) { setStatus('error'); setError(failure.message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useCommercialRevalidation(reload);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('commercial_catalog')) void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);

  function open(service = null) {
    const values = service ? { code: service.code, name: service.name, description: service.description,
      billingUnit: service.billingUnit, imageUrl: service.imageUrl ?? '',
      videoUrl: service.videoUrl ?? '', displayOrder: service.displayOrder,
      isPublic: service.isPublic, isActive: service.isActive, version: service.version } : { ...empty };
    setEditing(service?.id ?? null);
    setForm(values); setInitial(values); setImage(null); setVideo(null);
    setDrawerOpen(true); setNotice('');
  }
  function close() {
    if (busy) return;
    if (dirty) { setPendingClose(true); return; }
    setDrawerOpen(false);
  }
  function discard() { setPendingClose(false); setDrawerOpen(false); setImage(null); setVideo(null); }
  async function save(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const values = { ...form };
      if (image) values.imageUrl = (await uploadCommercialMedia('service-image', image)).url;
      if (video) values.videoUrl = (await uploadCommercialMedia('service-video', video)).url;
      await saveManagedService(editing, values);
      setNotice(editing ? 'Servicio actualizado. El catálogo público se refrescará.' : 'Servicio publicado en el catálogo.');
      setDrawerOpen(false); setImage(null); setVideo(null); await reload();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function retire() {
    const service = pendingRetire; setPendingRetire(null);
    try { await deleteManagedService(service.id, service.version); setNotice('Servicio retirado del catálogo.'); await reload(); }
    catch (failure) { setError(failure.message); }
  }
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <nav aria-label="Secciones de servicios" className="flex gap-2"><button type="button" onClick={() => setSection('catalog')} aria-current={section === 'catalog' ? 'page' : undefined} className="min-h-11 rounded-lg border px-4 text-sm">Catálogo</button>{canSeeClosures && <button type="button" onClick={() => setSection('closures')} aria-current={section === 'closures' ? 'page' : undefined} className="min-h-11 rounded-lg border px-4 text-sm">Solicitudes de clausura</button>}</nav>
    {canSeeClosures && section === 'closures' ? <ServiceClosurePanel mode="contracts" /> : <>
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Oferta</p><h1 className="mt-1 text-2xl font-bold">Servicios</h1><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Edite los servicios que ve la aerolínea al solicitar acceso. Las solicitudes conservan su selección histórica.</p></div>{canCreate && <button type="button" onClick={() => open()} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Crear servicio</button>}</header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && !drawerOpen && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <section className="rounded-xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex items-center justify-between"><h2 className="font-bold">Catálogo AVIAM</h2><button type="button" onClick={reload} className="text-xs font-semibold text-accent-600">Actualizar</button></div>
      {status === 'loading' ? <p className="mt-5 text-sm">Cargando servicios…</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{services.map(service => <article key={service.id} className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
        <ServiceCardImage url={service.imageUrl} />
        <div className="p-4"><div className="flex justify-between gap-2"><strong className="text-sm">{service.name}</strong><span className={`text-[11px] ${service.isActive && service.isPublic ? 'text-status-success' : 'text-text-secondary-light'}`}>{service.isActive && service.isPublic ? 'Público' : 'Oculto'}</span></div><p className="mt-1 min-h-14 text-xs leading-relaxed text-text-secondary-light">{service.description}</p><p className="mt-2 font-mono text-[10px] text-text-secondary-light">{service.code} · orden {service.displayOrder}</p>{(canEdit || canRetire) && <div className="mt-3 flex gap-3">{canEdit && <button type="button" onClick={() => open(service)} className="text-xs font-semibold text-accent-600">Editar</button>}{canRetire && <button type="button" onClick={() => setPendingRetire(service)} className="text-xs font-semibold text-status-danger">Retirar</button>}</div>}</div>
      </article>)}</div>}
    </section>
    <Drawer open={drawerOpen} onClose={close} title={editing ? 'Editar servicio' : 'Nuevo servicio'} description="Gestión contractual / Catálogo AVIAM" widthClassName="lg:w-[560px]" footer={<div className="flex items-center justify-between gap-3"><button type="button" onClick={close} className="text-sm font-semibold text-accent-600">Volver atrás</button><button type="submit" form="commercial-service-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar servicio'}</button></div>}>
      <form id="commercial-service-form" onSubmit={save} className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
        {[['code', 'Código', 40], ['name', 'Nombre', 160], ['billingUnit', 'Unidad de cobro', 32]].map(([key, label, max]) => <label key={key} className="block text-xs font-semibold">{label}<input required readOnly={key === 'code' && Boolean(editing)} maxLength={max} value={form[key]} onChange={event => change(key, key === 'code' ? event.target.value.toUpperCase() : event.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark" /></label>)}
        <label className="block text-xs font-semibold">Descripción<textarea required maxLength={500} rows={4} value={form.description} onChange={event => change('description', event.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark" /></label>
        <FileDropField label="Foto del servicio" accept="image/png,image/jpeg,image/webp" file={image} onFile={setImage} currentUrl={form.imageUrl} hint="PNG, JPG o WebP. Máximo 8 MB." />
        <FileDropField label="Video del servicio (opcional)" accept="video/mp4,video/webm" kind="video" file={video} onFile={setVideo} currentUrl={form.videoUrl} hint="MP4 o WebM. Máximo 24 MB." />
        <label className="block text-xs font-semibold">Orden<input type="number" min="0" max="10000" value={form.displayOrder} onChange={event => change('displayOrder', Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark" /></label>
        <div className="flex gap-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isPublic} onChange={event => change('isPublic', event.target.checked)} /> Visible al público</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isActive} onChange={event => change('isActive', event.target.checked)} /> Activo</label></div>
      </form>
    </Drawer>
    <ConfirmDialog open={pendingClose} title="Descartar cambios" description="Los cambios de este servicio no se guardarán." confirmLabel="Descartar" onClose={() => setPendingClose(false)} onConfirm={discard} />
    <ConfirmDialog open={Boolean(pendingRetire)} title="Retirar servicio" description={`¿Retirar ${pendingRetire?.name ?? ''} del catálogo público? Los contratos existentes conservarán su referencia.`} confirmLabel="Retirar" onClose={() => setPendingRetire(null)} onConfirm={retire} />
    </>}
  </div>;
}

function ServiceCardImage({ url }) {
  const src = usePrivateMediaUrl(url);
  return <div className="h-36 bg-surface-dark bg-cover bg-center" style={src ? { backgroundImage: `url("${src}")` } : {}} />;
}
