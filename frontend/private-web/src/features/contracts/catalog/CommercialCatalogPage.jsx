import { useCallback, useEffect, useRef, useState } from 'react';
import Drawer from '../../../components/Drawer';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Modal from '../../../components/Modal';
import FileDropField from '../../../components/FileDropField';
import Combobox, { OTHER_OPTION } from '../../../components/Combobox';
import { usePrivateMediaUrl } from '../../../hooks/usePrivateMediaUrl';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { createManagedService, getManagedServices, retireManagedService, updateManagedService,
  uploadCommercialMedia } from '../../../services/commercialGovernanceApi';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { listBillingUnits } from '../../../services/financeBookService';
import { serviceImageFallback } from './serviceImages';
import ServiceClosurePanel from './ServiceClosurePanel';
import { catalogProblemMessage } from './catalogErrorMessages';
import { billingUnitChoice, billingUnitOptions, buildServiceCatalog, buildServicePayload, nextDisplayOrder,
  sortServicesByOrder, validateServiceForm } from './serviceCatalogForm';
import { billingUnitLabel } from '../../../services/billingUnits';

const empty = { serviceChoice: '', name: '', code: '', unitChoice: '', description: '', imageUrl: '', videoUrl: '', displayOrder: 1, isPublic: true, isActive: true, version: null };
const PAGE_SIZE = 12;
const REASON_MIN = 10;
const REASON_MAX = 1000;
// Campos del formulario en el orden en que se enfoca el primero con error.
const FIELD_IDS = { serviceChoice: 'service-name', name: 'service-edit-name', customName: 'service-custom-name',
  customCode: 'service-custom-code', unitChoice: 'service-billing-unit',
  description: 'service-description', isPublic: 'service-is-public' };
const dependentClassName = 'space-y-4 border-l-2 border-accent-600/30 pl-3';
// 1-N03: «Oculto» sigue operable para contratos y OCC; «Dado de baja» ya no se ofrece ni se opera.
const AVAILABILITY = {
  public: { label: 'Público', className: 'text-status-success' },
  hidden: { label: 'Oculto', className: 'text-text-secondary-light' },
  retired: { label: 'Dado de baja', className: 'text-status-danger' },
};
const availabilityOf = service => (!service.isActive ? 'retired' : service.isPublic ? 'public' : 'hidden');

/** The body of the edit form for a service as listed, before a quick change of its availability. */
const payloadOf = service => ({ code: service.code, name: service.name, description: service.description,
  billingUnit: service.billingUnit, imageUrl: service.imageUrl ?? null, videoUrl: service.videoUrl ?? null,
  displayOrder: service.displayOrder, isPublic: service.isPublic, isActive: service.isActive, version: service.version });

/** A command the browser refused to send (incomplete service data) is explained without a request. */
const actionMessage = failure => (failure instanceof TypeError
  ? 'Revise los datos del servicio en «Editar» e intente de nuevo.' : catalogProblemMessage(failure));

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
  const [pendingAction, setPendingAction] = useState(null);
  const [reason, setReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState({ message: '', code: undefined });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('catalog');
  const [units, setUnits] = useState(null);
  // The intent the user is sending; a retry after an uncertain answer keeps its Idempotency-Key.
  const commands = useRef(createCommandKeyHolder());
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
      setStatus('ready'); setLoadError('');
      return updated;
    } catch (failure) {
      if (failure?.status === 403) { setStatus('forbidden'); setLoadError(''); }
      else { setStatus('error'); setLoadError(catalogProblemMessage(failure)); }
      return null;
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    let active = true;
    listBillingUnits().then(result => { if (active) setUnits(result); }).catch(() => { if (active) setUnits([]); });
    return () => { active = false; };
  }, []);
  useCommercialRevalidation(reload);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('commercial_catalog')) void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);

  const catalog = buildServiceCatalog(services);
  const editedService = editing ? services.find(service => service.id === editing) : null;
  const editedRetired = Boolean(editing) && !form.isActive;
  const unitOptions = billingUnitOptions(units, editedService?.billingUnit);
  const positionOf = new Map(services.map((service, index) => [service.id, index + 1]));

  function open(service = null) {
    const values = service ? { serviceChoice: service.code, name: service.name, code: service.code,
      unitChoice: billingUnitChoice(service.billingUnit, units),
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
  function discard() { setPendingClose(false); setDrawerOpen(false); setImage(null); setVideo(null); commands.current.reset(); }
  async function save(event) {
    event.preventDefault(); setError('');
    const found = validateServiceForm(form, { catalog, editingId: editing, hasNewImage: Boolean(image) });
    setErrors(found);
    if (Object.keys(found).length) {
      if (found.displayOrder) setError(found.displayOrder);
      const first = Object.keys(FIELD_IDS).find(key => found[key]);
      if (first) document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    setBusy(true);
    try {
      // A retired service is never published by the form (1-N03); a legacy row may still say «visible».
      const values = buildServicePayload(editedRetired ? { ...form, isPublic: false } : form);
      if (image) values.imageUrl = (await uploadCommercialMedia('service-image', image)).url;
      if (video) values.videoUrl = (await uploadCommercialMedia('service-video', video)).url;
      const saved = editing
        ? await commands.current.run(`update:${editing}`, values, key => updateManagedService(editing, values, key))
        : await createManagedService(values);
      setNotice(editing ? 'Servicio actualizado. El catálogo público se refrescará.'
        : values.isPublic && values.isActive ? 'Servicio publicado en el catálogo.'
          : 'Servicio guardado como oculto. Publíquelo cuando tenga foto y descripción.');
      setDrawerOpen(false); setImage(null); setVideo(null); await reload(saved?.id ?? editing);
    } catch (failure) {
      setError(actionMessage(failure));
      // The service changed while it was edited: the catalog is re-read before a new attempt.
      if (failure?.code === 'version_conflict') await reload(editing);
    } finally { setBusy(false); }
  }
  function startAction(kind, service) {
    setPendingAction({ kind, service }); setReason(''); setActionError({ message: '', code: undefined });
    setNotice(''); setError('');
  }
  function closeAction() { if (!actionBusy) { setPendingAction(null); setReason(''); } }
  async function runAction() {
    const { kind, service } = pendingAction;
    setActionBusy(true); setActionError({ message: '', code: undefined });
    try {
      if (kind === 'retire') {
        const command = { expectedVersion: service.version, reason: reason.trim() };
        await commands.current.run(`retire:${service.id}`, command, key => retireManagedService(service.id, command, key));
        setNotice(`${service.name} quedó dado de baja: ya no se ofrece en contratos nuevos ni en la operación.`);
      } else {
        // «Ocultar» only clears «Visible al público»; «Reactivar» keeps it hidden until it is published.
        const values = { ...payloadOf(service), isPublic: false, isActive: kind === 'reactivate' ? true : service.isActive };
        await commands.current.run(`${kind}:${service.id}`, values, key => updateManagedService(service.id, values, key));
        setNotice(kind === 'hide'
          ? `${service.name} ya no aparece en el catálogo público. Sigue activo para los contratos y la operación de OCC.`
          : `${service.name} está activo otra vez. Sigue oculto del catálogo público hasta que lo publique desde «Editar».`);
      }
      setPendingAction(null); setReason('');
      await reload(service.id);
    } catch (failure) {
      setActionError({ message: actionMessage(failure), code: failure?.code });
      // A conflict re-reads the catalog, and the dialog keeps the service as it is now.
      if (failure?.status === 409) {
        const updated = await reload(service.id);
        const fresh = updated?.find(item => item.id === service.id);
        if (fresh) setPendingAction({ kind, service: fresh });
      }
    } finally { setActionBusy(false); }
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
    update({ unitChoice: value }, 'unitChoice');
  }
  const isNew = !editing && form.serviceChoice === OTHER_OPTION;
  const existing = !editing ? catalog.find(entry => entry.code === form.serviceChoice)?.service : null;
  const serviceOptions = catalog.map(entry => ({ value: entry.code, label: entry.name,
    hint: entry.service ? `${entry.code} · ya en el catálogo` : entry.code }));
  const pageCount = Math.max(1, Math.ceil(services.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleServices = services.slice(pageStart, pageStart + PAGE_SIZE);
  const acting = pendingAction?.service;
  const reasonValid = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;
  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <nav aria-label="Secciones de servicios" className="flex gap-2"><button type="button" onClick={() => setSection('catalog')} aria-current={section === 'catalog' ? 'page' : undefined} className="min-h-11 rounded-lg border px-4 text-sm">Catálogo</button>{canSeeClosures && <button type="button" onClick={() => setSection('closures')} aria-current={section === 'closures' ? 'page' : undefined} className="min-h-11 rounded-lg border px-4 text-sm">Solicitudes de clausura</button>}</nav>
    {canSeeClosures && section === 'closures' ? <ServiceClosurePanel mode="contracts" /> : <>
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Oferta</p><h1 className="mt-1 text-2xl font-bold">Servicios</h1><p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Edite los servicios que ve la aerolínea al solicitar acceso. Las solicitudes conservan su selección histórica.</p><p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">«Ocultar del catálogo» solo lo quita de la vista de las aerolíneas: los contratos y la operación lo conservan. «Dar de baja» lo retira de contratos nuevos y de la operación, y no se permite mientras un contrato vigente o en aprobación lo incluya.</p><p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">Los servicios se muestran por número de orden, que asigna el sistema: cada servicio nuevo se agrega al final. El catálogo público usa el mismo orden.</p></div>{canCreate && status === 'ready' && <button type="button" onClick={() => open()} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Crear servicio</button>}</header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && !drawerOpen && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <section className="rounded-xl border border-black/10 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex items-center justify-between"><h2 className="font-bold">Catálogo AVIAM</h2>{status !== 'forbidden' && <button type="button" onClick={() => void reload()} className="text-xs font-semibold text-accent-600">Actualizar</button>}</div>
      {status === 'loading' && <p role="status" className="mt-5 text-sm">Cargando servicios…</p>}
      {status === 'forbidden' && <p role="alert" className="mt-5 rounded-lg bg-black/5 p-4 text-sm dark:bg-white/5">No tiene permiso para ver el catálogo de servicios.</p>}
      {status === 'error' && <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">
        <span>{loadError}</span>
        <button type="button" onClick={() => void reload()} className="min-h-10 rounded-lg border border-status-danger px-3 font-semibold">Reintentar</button>
      </div>}
      {status === 'ready' && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visibleServices.map(service => {
        const availability = availabilityOf(service);
        return <article key={service.id} className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
          <ServiceCardImage service={service} />
          <div className="p-4"><div className="flex justify-between gap-2"><div className="flex min-w-0 items-start gap-2"><span title="Número de orden asignado por el sistema" className="shrink-0 rounded-md bg-black/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-text-secondary-light dark:bg-white/10 dark:text-text-secondary-dark"><span className="sr-only">Número de orden </span><span aria-hidden="true">N.º </span>{positionOf.get(service.id)}</span><strong className="text-sm">{service.name}</strong></div><span className={`text-[11px] ${AVAILABILITY[availability].className}`}>{AVAILABILITY[availability].label}</span></div><p className="mt-1 min-h-14 text-xs leading-relaxed text-text-secondary-light">{service.description}</p><p className="mt-2 font-mono text-[10px] text-text-secondary-light">{service.code} · por {billingUnitLabel(service.billingUnit, units ?? [])}</p>
            {(canEdit || canRetire) && <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
              {canEdit && <button type="button" onClick={() => open(service)} className="text-xs font-semibold text-accent-600">Editar</button>}
              {canEdit && availability === 'public' && <button type="button" onClick={() => startAction('hide', service)} className="text-xs font-semibold text-accent-600">Ocultar del catálogo</button>}
              {canRetire && availability !== 'retired' && <button type="button" onClick={() => startAction('retire', service)} className="text-xs font-semibold text-status-danger">Dar de baja</button>}
              {canEdit && availability === 'retired' && <button type="button" onClick={() => startAction('reactivate', service)} className="text-xs font-semibold text-accent-600">Reactivar</button>}
            </div>}</div>
        </article>;
      })}</div>}
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
          {editedRetired && <p role="note" className="rounded-lg bg-status-danger/10 p-3 text-xs">Este servicio está dado de baja: no se ofrece en contratos nuevos ni en la operación. Para volver a ofrecerlo use «Reactivar» en su tarjeta.</p>}
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
                <p><strong>{existing.name}</strong> ya está en el catálogo con el número de orden {positionOf.get(existing.id)}{!existing.isActive ? ' y está dado de baja' : existing.isPublic ? '' : ' y está oculto'}. No se puede crear dos veces.</p>
                {canEdit && <button type="button" onClick={() => open(existing)} className="mt-2 font-semibold text-accent-600">Editar este servicio</button>}
              </div>}
            </div>
          </>}
          <Combobox id={FIELD_IDS.unitChoice} label="Unidad de cobro" required value={form.unitChoice} options={unitOptions}
            onChange={chooseUnit} placeholder={units === null ? 'Cargando unidades…' : 'Seleccionar unidad'} error={errors.unitChoice} allowOther={false}
            hint="¿Cómo se mide este servicio? Las unidades las mantiene Finanzas en «Unidades de cobro»; si falta una, pídala allí." />
          <TextField id={FIELD_IDS.description} label="Descripción" required multiline maxLength={500} value={form.description}
            onChange={value => change('description', value)} error={errors.description}
            hint={`Texto que verá la aerolínea en el catálogo (${form.description.length}/500).`} />
          <FileDropField label="Foto del servicio" accept="image/png,image/jpeg,image/webp" file={image} onFile={setImage} currentUrl={form.imageUrl} hint="PNG, JPG o WebP. Máximo 8 MB." />
          <FileDropField label="Video del servicio (opcional)" accept="video/mp4,video/webm" kind="video" file={video} onFile={setVideo} currentUrl={form.videoUrl} hint="MP4 o WebM. Máximo 24 MB." />
          <div className="rounded-lg border border-dashed border-black/15 p-3 text-xs dark:border-white/15">
            <p className="font-semibold">Número de orden <span className="ml-1 rounded-md bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">N.º {editing ? positionOf.get(editing) : form.displayOrder === null ? '—' : services.length + 1}</span></p>
            <p className="mt-1 text-text-secondary-light dark:text-text-secondary-dark">{editing ? 'Lo asigna el sistema y se conserva al editar.' : 'Lo asigna el sistema: el servicio nuevo se agrega al final del catálogo.'}</p>
          </div>
          <div><label className="flex items-center gap-2 text-xs"><input id={FIELD_IDS.isPublic} type="checkbox" checked={form.isPublic && !editedRetired} disabled={editedRetired} aria-invalid={errors.isPublic ? true : undefined} aria-describedby="service-is-public-hint" onChange={event => change('isPublic', event.target.checked)} /> Visible al público</label>
            <p id="service-is-public-hint" className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{editedRetired ? 'Un servicio dado de baja no se publica: reactívelo primero.' : 'Desmarcado, el servicio se oculta del catálogo público y sigue activo para los contratos y la operación.'}</p></div>
          {errors.isPublic && <p role="alert" className="text-xs text-status-danger">{errors.isPublic} Puede guardarlo oculto mientras tanto.</p>}
        </fieldset>
      </form>
    </Drawer>
    <ConfirmDialog open={pendingClose} title="Descartar cambios" description="Los cambios de este servicio no se guardarán." confirmLabel="Descartar" onClose={() => setPendingClose(false)} onConfirm={discard} />
    <Modal open={pendingAction?.kind === 'hide'} onClose={closeAction} title="Ocultar del catálogo público" busy={actionBusy}
      footer={<ActionButtons busy={actionBusy} onCancel={closeAction} onConfirm={() => { void runAction(); }} confirmLabel="Ocultar" busyLabel="Ocultando…" />}>
      <div className="space-y-3 text-sm">
        <p>{acting?.name} dejará de aparecer para las aerolíneas que solicitan acceso.</p>
        <p>Sigue activo: los contratos que lo incluyen y la operación de OCC no cambian. Puede volver a publicarlo desde «Editar».</p>
        {actionError.message && <p role="alert" className="text-status-danger">{actionError.message}</p>}
      </div>
    </Modal>
    <Modal open={pendingAction?.kind === 'reactivate'} onClose={closeAction} title="Reactivar servicio" busy={actionBusy}
      footer={<ActionButtons busy={actionBusy} onCancel={closeAction} onConfirm={() => { void runAction(); }} confirmLabel="Reactivar" busyLabel="Reactivando…" />}>
      <div className="space-y-3 text-sm">
        <p>{acting?.name} volverá a estar disponible para contratos nuevos y para la operación.</p>
        <p>Seguirá oculto del catálogo público hasta que lo publique desde «Editar».</p>
        {actionError.message && <p role="alert" className="text-status-danger">{actionError.message}</p>}
      </div>
    </Modal>
    <Modal open={pendingAction?.kind === 'retire'} onClose={closeAction} title={`Dar de baja ${acting?.name ?? ''}`} tone="danger" busy={actionBusy}
      footer={<>
        {actionError.code === 'service_in_active_contract' && canEdit && acting?.isPublic &&
          <button type="button" disabled={actionBusy} onClick={() => startAction('hide', acting)} className="rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600">Ocultar del catálogo</button>}
        <ActionButtons busy={actionBusy} onCancel={closeAction} onConfirm={() => { void runAction(); }} confirmLabel="Dar de baja"
          busyLabel="Dando de baja…" disabled={!reasonValid} danger />
      </>}>
      <div className="space-y-3 text-sm">
        <p>El servicio sale del catálogo público y ya no podrá agregarse a contratos nuevos ni planificarse en la operación. La baja queda registrada con su motivo.</p>
        <p>No se permite mientras un contrato vigente o en aprobación lo incluya. Si solo quiere dejar de ofrecerlo a nuevas aerolíneas, use «Ocultar del catálogo».</p>
        <label className="block text-xs font-semibold">Motivo de la baja<textarea rows={3} maxLength={REASON_MAX} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded-lg border px-3 py-2 font-normal dark:bg-surface-dark" /></label>
        <p className="text-xs text-text-secondary-light">Entre {REASON_MIN} y {REASON_MAX} caracteres.</p>
        {actionError.message && <p role="alert" className="text-status-danger">{actionError.message}</p>}
      </div>
    </Modal>
    </>}
  </div>;
}

function ActionButtons({ busy, onCancel, onConfirm, confirmLabel, busyLabel, disabled = false, danger = false }) {
  return <>
    <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold dark:border-white/15">Cancelar</button>
    <button type="button" disabled={busy || disabled} onClick={onConfirm} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${danger ? 'bg-status-danger' : 'bg-accent-600'}`}>{busy ? busyLabel : confirmLabel}</button>
  </>;
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

/** Uploaded photo, or an illustration of the service type when there is none or it cannot load. */
function ServiceCardImage({ service }) {
  const src = usePrivateMediaUrl(service.imageUrl);
  const [failed, setFailed] = useState(false);
  const fallback = serviceImageFallback(service);
  const showPhoto = Boolean(service.imageUrl) && Boolean(src) && !failed;
  return <div className="relative h-36 overflow-hidden bg-surface-dark">
    <img src={showPhoto ? src : fallback} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
    {!service.imageUrl && <span className="absolute bottom-2 left-2 rounded bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-ink-900">Sin foto · ilustración</span>}
    {service.imageUrl && failed && <span role="status" className="absolute bottom-2 left-2 rounded bg-status-danger px-2 py-0.5 text-[10px] font-semibold text-white">No se pudo cargar la foto</span>}
  </div>;
}
