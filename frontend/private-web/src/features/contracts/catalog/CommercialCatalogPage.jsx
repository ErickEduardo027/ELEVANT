import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../../components/Drawer';
import ConfirmDialog from '../../../components/ConfirmDialog';
import FileDropField from '../../../components/FileDropField';
import Combobox, { OTHER_OPTION } from '../../../components/Combobox';
import { usePrivateMediaUrl } from '../../../hooks/usePrivateMediaUrl';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { deleteManagedService, getManagedServices, saveManagedService, uploadCommercialMedia } from '../../../services/commercialGovernanceApi';
import ServiceClosurePanel from './ServiceClosurePanel';
import { billingUnitOptions, buildServiceCatalog, buildServicePayload, nextDisplayOrder, normalizeText,
  sortServicesByOrder, validateServiceForm } from './serviceCatalogForm';

const empty = { serviceChoice: '', name: '', code: '', unitChoice: '', customUnit: '', description: '', imageUrl: '', videoUrl: '', displayOrder: 1, isPublic: true, isActive: true, version: null };
const PAGE_SIZE = 12;
// Campos del formulario en el orden en que se enfoca el primero con error.
const FIELD_IDS = { serviceChoice: 'service-name', name: 'service-edit-name', customName: 'service-custom-name',
  customCode: 'service-custom-code', unitChoice: 'service-billing-unit', customUnit: 'service-custom-unit',
  description: 'service-description' };
const dependentClassName = 'space-y-4 border-l-2 border-accent-600/30 pl-3';

export default function CommercialCatalogPage({ canCreate = true, canEdit = true,
  canRetire = true, canSeeClosures = true }) {
  const [services, setServices] = useState([]);
  const [page, setPage] = useState(1);
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
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('catalog');
  const dirty = image !== null || video !== null || JSON.stringify(form) !== JSON.stringify(initial);

  const reload = useCallback(async (focusId = null) => {
    try {
      const updated = sortServicesByOrder(await getManagedServices());
      setServices(updated);
      setPage(current => {
        const focusIndex = typeof focusId === 'string'
          ? updated.findIndex(service => service.id === focusId) : -1;
        if (focusIndex >= 0) return Math.floor(focusIndex / PAGE_SIZE) + 1;
        return Math.min(current, Math.max(1, Math.ceil(updated.length / PAGE_SIZE)));
      });
      setStatus('ready'); setError('');
    }
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

  const catalog = buildServiceCatalog(services);
  const unitOptions = billingUnitOptions(services);
  const positionOf = new Map(services.map((service, index) => [service.id, index + 1]));

  function open(service = null) {
    const unit = service && unitOptions.find(option => option.value === normalizeText(service.billingUnit));
    const values = service ? { serviceChoice: service.code, name: service.name, code: service.code,
      unitChoice: unit ? unit.value : OTHER_OPTION, customUnit: unit ? '' : service.billingUnit,
      description: service.description, imageUrl: service.imageUrl ?? '',
      videoUrl: service.videoUrl ?? '', displayOrder: service.displayOrder,
      isPublic: service.isPublic, isActive: service.isActive, version: service.version }
      : { ...empty, displayOrder: nextDisplayOrder(services) };
    setEditing(service?.id ?? null);
    setForm(values); setInitial(values); setImage(null); setVideo(null);
    setErrors({}); setError(''); setDrawerOpen(true); setNotice('');
  }
  function close() {
    if (busy) return;
    if (dirty) { setPendingClose(true); return; }
    setDrawerOpen(false);
  }
  function discard() { setPendingClose(false); setDrawerOpen(false); setImage(null); setVideo(null); }
  async function save(event) {
    event.preventDefault(); setError('');
    const found = validateServiceForm(form, { catalog, editingId: editing });
    setErrors(found);
    if (Object.keys(found).length) {
      if (found.displayOrder) setError(found.displayOrder);
      const first = Object.keys(FIELD_IDS).find(key => found[key]);
      if (first) document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    setBusy(true);
    try {
      const values = buildServicePayload(form);
      if (image) values.imageUrl = (await uploadCommercialMedia('service-image', image)).url;
      if (video) values.videoUrl = (await uploadCommercialMedia('service-video', video)).url;
      const saved = await saveManagedService(editing, values);
      setNotice(editing ? 'Servicio actualizado. El catálogo público se refrescará.' : 'Servicio publicado en el catálogo.');
      setDrawerOpen(false); setImage(null); setVideo(null); await reload(saved?.id ?? editing);
    } catch (failure) { setError(saveErrorMessage(failure, Boolean(editing))); }
    finally { setBusy(false); }
  }
  async function retire() {
    const service = pendingRetire; setPendingRetire(null);
    try { await deleteManagedService(service.id, service.version); setNotice('Servicio retirado del catálogo.'); await reload(); }
    catch (failure) { setError(failure.message); }
  }
  function update(values, ...errorKeys) {
    setForm(current => ({ ...current, ...values }));
    setErrors(current => (errorKeys.some(key => current[key])
      ? Object.fromEntries(Object.entries(current).filter(([key]) => !errorKeys.includes(key))) : current));
  }
  const change = (key, value) => update({ [key]: value }, key);
  function chooseService(value) {
    const entry = catalog.find(item => item.code === value);
    update(entry ? { serviceChoice: value, name: entry.name, code: entry.code } : { serviceChoice: value, name: '', code: '' },
      'serviceChoice', 'customName', 'customCode');
  }
  function chooseUnit(value) {
    update({ unitChoice: value, customUnit: '' }, 'unitChoice', 'customUnit');
  }
  const isNew = !editing && form.serviceChoice === OTHER_OPTION;
  const existing = !editing ? catalog.find(entry => entry.code === form.serviceChoice)?.service : null;
  const serviceOptions = catalog.map(entry => ({ value: entry.code, label: entry.name,
    hint: entry.service ? `${entry.code} · ya en el catálogo` : entry.code }));
  const pageCount = Math.max(1, Math.ceil(services.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleServices = services.slice(pageStart, pageStart + PAGE_SIZE);
  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <nav aria-label="Secciones de servicios" className="flex gap-2"><button type="button" onClick={() => setSection('catalog')} aria-current={section === 'catalog' ? 'page' : undefined} className="min-h-11 rounded-lg border px-4 text-sm">Catálogo</button>{canSeeClosures && <button type="button" onClick={() => setSection('closures')} aria-current={section === 'closures' ? 'page' : undefined} className="min-h-11 rounded-lg border px-4 text-sm">Solicitudes de clausura</button>}</nav>
    {canSeeClosures && section === 'closures' ? <ServiceClosurePanel mode="contracts" /> : <>
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Oferta</p><h1 className="mt-1 text-2xl font-bold">Servicios</h1><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Edite los servicios que ve la aerolínea al solicitar acceso. Las solicitudes conservan su selección histórica.</p><p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">Los servicios se muestran por número de orden, que asigna el sistema: cada servicio nuevo se agrega al final. El catálogo público usa el mismo orden.</p></div>{canCreate && <button type="button" onClick={() => open()} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Crear servicio</button>}</header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && !drawerOpen && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <section className="rounded-xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex items-center justify-between"><h2 className="font-bold">Catálogo AVIAM</h2><button type="button" onClick={() => void reload()} className="text-xs font-semibold text-accent-600">Actualizar</button></div>
      {status === 'loading' ? <p className="mt-5 text-sm">Cargando servicios…</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleServices.map(service => <article key={service.id} className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
        <ServiceCardImage url={service.imageUrl} />
        <div className="p-4"><div className="flex justify-between gap-2"><div className="flex min-w-0 items-start gap-2"><span title="Número de orden asignado por el sistema" className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-text-secondary-light dark:bg-white/10 dark:text-text-secondary-dark"><span className="sr-only">Número de orden </span><span aria-hidden="true">N.º </span>{positionOf.get(service.id)}</span><strong className="text-sm">{service.name}</strong></div><span className={`text-[11px] ${service.isActive && service.isPublic ? 'text-status-success' : 'text-text-secondary-light'}`}>{service.isActive && service.isPublic ? 'Público' : 'Oculto'}</span></div><p className="mt-1 min-h-14 text-xs leading-relaxed text-text-secondary-light">{service.description}</p><p className="mt-2 font-mono text-[10px] text-text-secondary-light">{service.code} · por {service.billingUnit}</p>{(canEdit || canRetire) && <div className="mt-3 flex gap-3">{canEdit && <button type="button" onClick={() => open(service)} className="text-xs font-semibold text-accent-600">Editar</button>}{canRetire && <button type="button" onClick={() => setPendingRetire(service)} className="text-xs font-semibold text-status-danger">Retirar</button>}</div>}</div>
      </article>)}</div>}
      {status === 'ready' && services.length === 0 && <p className="mt-4 text-sm text-text-secondary-light dark:text-text-secondary-dark">No hay servicios en el catálogo.</p>}
      {status === 'ready' && <nav aria-label="Paginación de servicios" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-4 text-sm dark:border-white/10">
        <p className="text-text-secondary-light dark:text-text-secondary-dark">Mostrando {services.length ? pageStart + 1 : 0}–{Math.min(pageStart + PAGE_SIZE, services.length)} de {services.length} servicios</p>
        <div className="flex items-center gap-3"><button type="button" disabled={currentPage === 1} onClick={() => setPage(current => current - 1)} className="min-h-10 rounded-lg border border-black/10 px-3 font-semibold text-accent-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10">Anterior</button><span>Página {currentPage} de {pageCount}</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(current => current + 1)} className="min-h-10 rounded-lg border border-black/10 px-3 font-semibold text-accent-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10">Siguiente</button></div>
      </nav>}
    </section>
    <Drawer open={drawerOpen} onClose={close} title={editing ? 'Editar servicio' : 'Nuevo servicio'} description="Gestión contractual / Catálogo AVIAM" widthClassName="lg:w-[560px]" footer={<div className="flex items-center justify-between gap-3"><button type="button" onClick={close} className="text-sm font-semibold text-accent-600">Volver atrás</button><button type="submit" form="commercial-service-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar servicio'}</button></div>}>
      <form id="commercial-service-form" onSubmit={save} noValidate>
        <fieldset disabled={busy} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Los campos marcados con <span aria-hidden="true" className="text-status-danger">*</span><span className="sr-only">asterisco</span> son obligatorios.</p>
          {editing ? <>
            <TextField id={FIELD_IDS.name} label="Nombre del servicio" required maxLength={160} value={form.name}
              onChange={value => change('name', value)} error={errors.name} />
            <TextField id="service-code" label="Código" value={form.code} readOnly mono
              hint="El código identifica al servicio y no se puede cambiar." />
          </> : <>
            <Combobox id={FIELD_IDS.serviceChoice} label="Nombre del servicio" required value={form.serviceChoice} options={serviceOptions}
              onChange={chooseService} placeholder="Buscar por nombre o código" error={errors.serviceChoice}
              hint="Cada servicio tiene su propio código. Elige «Otro» para registrar uno que no esté en la lista." otherHint="Servicio nuevo" />
            <div className={dependentClassName}>
              {isNew ? <>
                <TextField id={FIELD_IDS.customName} label="Nombre personalizado" required maxLength={160} value={form.name}
                  onChange={value => update({ name: value }, 'customName')} error={errors.customName} />
                <TextField id={FIELD_IDS.customCode} label="Código del nuevo servicio" required maxLength={40} mono value={form.code}
                  onChange={value => update({ code: value.toUpperCase() }, 'customCode')} error={errors.customCode}
                  hint="Letras A–Z, números y guiones, sin espacios. No puede repetir el código de otro servicio." />
              </> : <TextField id="service-code" label="Código" value={form.code} readOnly mono placeholder="Se completa al elegir el servicio"
                hint="Se asigna automáticamente según el servicio seleccionado." />}
              {existing && <div role="status" className="rounded-lg bg-accent-600/5 p-3 text-xs">
                <p><strong>{existing.name}</strong> ya está en el catálogo con el número de orden {positionOf.get(existing.id)}{existing.isActive && existing.isPublic ? '' : ' y está oculto'}. No se puede crear dos veces.</p>
                {canEdit && <button type="button" onClick={() => open(existing)} className="mt-2 font-semibold text-accent-600">Editar este servicio</button>}
              </div>}
            </div>
          </>}
          <Combobox id={FIELD_IDS.unitChoice} label="Unidad de cobro" required value={form.unitChoice} options={unitOptions}
            onChange={chooseUnit} placeholder="Seleccionar unidad" error={errors.unitChoice}
            hint="¿Cómo se factura o mide este servicio? Elige la unidad que corresponda al contrato." otherHint="Escribir otra unidad" />
          {form.unitChoice === OTHER_OPTION && <div className={dependentClassName}>
            <TextField id={FIELD_IDS.customUnit} label="Unidad de cobro personalizada" required maxLength={32} value={form.customUnit}
              onChange={value => change('customUnit', value)} error={errors.customUnit}
              hint="Escríbela en singular, por ejemplo «turno»; las tarifas la muestran como «Precio por …»." />
          </div>}
          <TextField id={FIELD_IDS.description} label="Descripción" required multiline maxLength={500} value={form.description}
            onChange={value => change('description', value)} error={errors.description}
            hint={`Texto que verá la aerolínea en el catálogo (${form.description.length}/500).`} />
          <FileDropField label="Foto del servicio" accept="image/png,image/jpeg,image/webp" file={image} onFile={setImage} currentUrl={form.imageUrl} hint="PNG, JPG o WebP. Máximo 8 MB." />
          <FileDropField label="Video del servicio (opcional)" accept="video/mp4,video/webm" kind="video" file={video} onFile={setVideo} currentUrl={form.videoUrl} hint="MP4 o WebM. Máximo 24 MB." />
          <div className="rounded-lg border border-dashed border-black/15 p-3 text-xs dark:border-white/15">
            <p className="font-semibold">Número de orden <span className="ml-1 rounded-md bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">N.º {editing ? positionOf.get(editing) : form.displayOrder === null ? '—' : services.length + 1}</span></p>
            <p className="mt-1 text-text-secondary-light dark:text-text-secondary-dark">{editing ? 'Lo asigna el sistema y se conserva al editar.' : 'Lo asigna el sistema: el servicio nuevo se agrega al final del catálogo.'}</p>
          </div>
          <div className="flex gap-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isPublic} onChange={event => change('isPublic', event.target.checked)} /> Visible al público</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.isActive} onChange={event => change('isActive', event.target.checked)} /> Activo</label></div>
        </fieldset>
      </form>
    </Drawer>
    <ConfirmDialog open={pendingClose} title="Descartar cambios" description="Los cambios de este servicio no se guardarán." confirmLabel="Descartar" onClose={() => setPendingClose(false)} onConfirm={discard} />
    <ConfirmDialog open={Boolean(pendingRetire)} title="Retirar servicio" description={`¿Retirar ${pendingRetire?.name ?? ''} del catálogo público? Los contratos existentes conservarán su referencia.`} confirmLabel="Retirar" onClose={() => setPendingRetire(null)} onConfirm={retire} />
    </>}
  </div>;
}

function saveErrorMessage(failure, editing) {
  if (failure.status === 409) {
    return editing ? 'No se pudo guardar porque el servicio cambió. Actualiza el catálogo e inténtalo de nuevo.'
      : 'No se pudo guardar: ya existe un servicio con ese código o el catálogo cambió. Actualiza el catálogo e inténtalo de nuevo.';
  }
  if (failure.status === 400) return 'El sistema rechazó los datos del servicio. Revisa los campos e inténtalo de nuevo.';
  return failure.message;
}

function TextField({ id, label, value, onChange, hint, error, placeholder, required = false, multiline = false, mono = false, readOnly = false, maxLength }) {
  const messageId = `${id}-message`;
  const Element = multiline ? 'textarea' : 'input';
  return <div className="block text-xs font-semibold">
    <label htmlFor={id}>{label}{required && <span aria-hidden="true" className="ml-0.5 text-status-danger">*</span>}</label>
    <Element id={id} value={value} readOnly={readOnly} maxLength={maxLength} placeholder={placeholder} rows={multiline ? 4 : undefined}
      onChange={onChange && (event => onChange(event.target.value))}
      aria-required={required || undefined} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? messageId : undefined}
      className={`mt-1 block w-full rounded-lg border bg-white p-2 text-sm font-normal focus:border-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-600/20 disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-black/5 dark:bg-surface-dark dark:read-only:bg-white/5 ${mono ? 'font-mono' : ''} ${error ? 'border-status-danger' : 'border-black/10 dark:border-white/10'}`} />
    {(error || hint) && <p id={messageId} className={`mt-1 text-xs font-normal ${error ? 'text-status-danger' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>{error || hint}</p>}
  </div>;
}

function ServiceCardImage({ url }) {
  const src = usePrivateMediaUrl(url);
  return <div className="h-36 bg-surface-dark bg-cover bg-center" style={src ? { backgroundImage: `url("${src}")` } : {}} />;
}
