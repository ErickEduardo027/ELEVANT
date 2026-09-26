import { useCallback, useEffect, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { deleteManagedService, getManagedServices, saveManagedService } from '../../../services/commercialGovernanceApi';

const empty = { code: '', name: '', description: '', billingUnit: 'operación', imageUrl: '', videoUrl: '', displayOrder: 1, isPublic: true, isActive: true, version: null };

export default function CommercialCatalogPage({ canWrite = true }) {
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reload = useCallback(async () => {
    try { setServices(await getManagedServices()); setStatus('ready'); setError(''); }
    catch (failure) { setStatus('error'); setError(failure.message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('commercial_catalog')) void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);

  function select(service) {
    setEditing(service.id);
    setForm({ code: service.code, name: service.name, description: service.description,
      billingUnit: service.billingUnit, imageUrl: service.imageUrl ?? '',
      videoUrl: service.videoUrl ?? '', displayOrder: service.displayOrder,
      isPublic: service.isPublic, isActive: service.isActive, version: service.version });
    setNotice('');
  }
  async function save(event) {
    event.preventDefault(); setError('');
    try {
      await saveManagedService(editing, form);
      setNotice(editing ? 'Servicio actualizado. El catálogo público se refrescará.' : 'Servicio publicado en el catálogo.');
      setEditing(null); setForm(empty); await reload();
    } catch (failure) { setError(failure.message); }
  }
  async function remove(service) {
    if (!window.confirm(`¿Retirar ${service.name} del catálogo público? Los contratos existentes conservarán su referencia.`)) return;
    try { await deleteManagedService(service.id, service.version); setNotice('Servicio retirado del catálogo.'); await reload(); }
    catch (failure) { setError(failure.message); }
  }
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Oferta</p><h1 className="mt-1 text-2xl font-bold">Servicios</h1><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Edite los servicios que ve la aerolínea al solicitar acceso. Las solicitudes guardan el nombre seleccionado como referencia histórica.</p></header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
        <div className="flex items-center justify-between"><h2 className="font-bold">Catálogo AVIAM</h2><button type="button" onClick={reload} className="text-xs font-semibold text-accent-600">Actualizar</button></div>
        {status === 'loading' ? <p className="mt-5 text-sm">Cargando servicios…</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{services.map(service => <article key={service.id} className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
          <div className="h-32 bg-surface-dark bg-cover bg-center" style={service.imageUrl ? { backgroundImage: `url(${service.imageUrl})` } : {}} />
          <div className="p-4"><div className="flex justify-between gap-2"><strong className="text-sm">{service.name}</strong><span className={`text-[11px] ${service.isActive && service.isPublic ? 'text-status-success' : 'text-text-secondary-light'}`}>{service.isActive && service.isPublic ? 'Público' : 'Oculto'}</span></div><p className="mt-1 min-h-14 text-xs leading-relaxed text-text-secondary-light">{service.description}</p><p className="mt-2 font-mono text-[10px] text-text-secondary-light">{service.code} · orden {service.displayOrder}</p>{canWrite && <div className="mt-3 flex gap-3"><button type="button" onClick={() => select(service)} className="text-xs font-semibold text-accent-600">Editar</button><button type="button" onClick={() => remove(service)} className="text-xs font-semibold text-status-danger">Retirar</button></div>}</div>
        </article>)}</div>}
      </section>
      {canWrite && <form onSubmit={save} className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card"><h2 className="font-bold">{editing ? 'Editar servicio' : 'Nuevo servicio'}</h2>
        {[['code', 'Código', 40], ['name', 'Nombre', 160], ['billingUnit', 'Unidad de cobro', 32], ['imageUrl', 'URL de la foto', 512], ['videoUrl', 'URL de video', 512]].map(([key, label, max]) => <label key={key} className="mt-4 block text-xs font-semibold">{label}<input required={['code', 'name', 'billingUnit'].includes(key)} readOnly={key === 'code' && Boolean(editing)} maxLength={max} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: key === 'code' ? event.target.value.toUpperCase() : event.target.value }))} className="mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark" /></label>)}
        <label className="mt-4 block text-xs font-semibold">Descripción<textarea required maxLength={500} rows={3} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} className="mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark" /></label>
        <label className="mt-4 block text-xs font-semibold">Orden<input type="number" min="0" max="10000" value={form.displayOrder} onChange={event => setForm(current => ({ ...current, displayOrder: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark" /></label>
        <div className="mt-4 flex gap-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isPublic} onChange={event => setForm(current => ({ ...current, isPublic: event.target.checked }))} /> Visible al público</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} /> Activo</label></div>
        <p className="mt-3 text-xs text-text-secondary-light">Se admiten rutas /assets/ o URL HTTPS. El video es opcional.</p>
        <div className="mt-5 flex gap-2"><button className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Guardar servicio</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(empty); }} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button>}</div>
      </form>}
    </div>
  </div>;
}
