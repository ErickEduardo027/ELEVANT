'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import FiscalXmlValidationPanel from './FiscalXmlValidationPanel';
import StatusBadge from '../../../components/StatusBadge';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { formatMoney, getFinanceInvoice, listFinanceInvoices } from '../../../services/financeBookService';
import { createFiscalCommand, createFiscalDocument, downloadFiscalArtifact, fiscalError, getFiscalDocument,
  getFiscalStatus, listFiscalDocuments, simulateFiscalDocument } from '../../../services/financeFiscalService';

const button = 'rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-white/15';
const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const panel = 'min-w-0 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card';
const states = { AwaitingArchive: ['Por archivar', 'info'], Archiving: ['Archivando', 'info'], ArchiveBlocked: ['Archivo bloqueado', 'danger'],
  Dispatching: ['Resultado por confirmar', 'warning'], Accepted: ['Aceptado (simulado)', 'success'], Rejected: ['Rechazado (simulado)', 'danger'],
  Conditional: ['Condicional (simulado)', 'warning'], Pending: ['Pendiente (simulado)', 'warning'], Unknown: ['Desconocido', 'warning'] };
const outcomes = { Accepted: 'Aceptado', Rejected: 'Rechazado', Conditional: 'Condicional', Pending: 'Pendiente', Timeout: 'Tiempo agotado', Unknown: 'Desconocido' };
const date = value => new Date(value).toLocaleString('es-DO');
function Badge({ state }) { const [label, tone] = states[state] ?? [state, 'neutral']; return <StatusBadge label={label} tone={tone} />; }

export default function FiscalDocumentsPage({ initialInvoiceId = '' }) {
  const { access } = useDepartmentAccess();
  const canRead = access?.can('finance.fiscal.read') ?? false;
  const canReadInvoices = access?.can('finance.reconciliation.read') ?? false;
  const canManage = (access?.can('finance.fiscal.create') ?? false) && (access?.can('finance.fiscal.simulate') ?? false);
  const [data, setData] = useState({ status: 'loading', documents: [], config: null });
  const [stationId, setStationId] = useState('');
  const [selection, setSelection] = useState(null);
  const [detailStatus, setDetailStatus] = useState('idle');
  const [detailError, setDetailError] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [command] = useState(createFiscalCommand);
  const selectionRequest = useRef(0);
  const selectedDocumentId = useRef(null);
  const loadRequest = useRef(0);
  const locked = useRef(false);
  const stations = access?.stations?.length ? access.stations : readSession()?.stationScopes ?? [];
  const active = canManage && data.config?.mode === 'LocalSimulation' && data.config?.canSimulate;
  const chooseInvoice = useCallback(invoice => setForm(previous => previous ? { ...previous, invoice } : previous), []);

  const load = useCallback(async () => {
    if (!canRead) return;
    const request = ++loadRequest.current;
    setData(previous => ({ ...previous, status: 'loading', error: '' }));
    try {
      const [config, documents] = await Promise.all([getFiscalStatus(), listFiscalDocuments({ stationId, take: 50 })]);
      if (request === loadRequest.current) setData({ status: 'ready', config, documents });
    } catch (failure) {
      if (request === loadRequest.current) setData(previous => ({ ...previous, status: 'error', error: fiscalError(failure) }));
    }
  }, [canRead, stationId]);
  const cancelLoad = useCallback(() => { ++loadRequest.current; }, []);
  useEffect(() => { void load(); return cancelLoad; }, [load, cancelLoad]);

  async function select(id, keepError = false) {
    const request = ++selectionRequest.current;
    selectedDocumentId.current = id;
    setDetailStatus('loading'); setDetailError(''); setSelection(null); if (!keepError) setError(''); setForm(null);
    try {
      const detail = await getFiscalDocument(id);
      if (request === selectionRequest.current) { setSelection(detail); setDetailStatus('ready'); }
    } catch (failure) {
      if (request === selectionRequest.current) { setDetailStatus('error'); setDetailError(fiscalError(failure)); }
    }
  }
  async function create(event) {
    event.preventDefault();
    if (!active || !canReadInvoices || !form?.invoice?.id || (stationId && form.invoice.stationId !== stationId) || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await command('create', { invoiceId: form.invoice.id, outcome: form.outcome }, createFiscalDocument);
      setNotice('Documento canónico creado. Revise y ejecute la simulación local.');
      setForm(null); await load(); await select(result.documentId);
    } catch (failure) { setError(fiscalError(failure)); }
    finally { locked.current = false; setBusy(false); }
  }
  async function simulate() {
    if (!active || locked.current || !selection || !['AwaitingArchive', 'ArchiveBlocked'].includes(selection.state)) return;
    locked.current = true; setBusy(true); setError(''); setConfirm(false);
    try {
      await command('simulate:' + selection.id, { expectedVersion: selection.version }, input => simulateFiscalDocument(selection.id, input));
      setNotice('Simulación procesada. Consulte el estado y el archivo conservado.');
    } catch (failure) { setError(fiscalError(failure)); }
    finally {
      // Always reconcile before enabling another action, including after a lost response.
      const id = selection.id;
      await load(); await select(id, true); locked.current = false; setBusy(false);
    }
  }
  async function download(artifact) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await downloadFiscalArtifact(selection.id, artifact); }
    catch (failure) { setError(fiscalError(failure)); }
    finally { locked.current = false; setBusy(false); }
  }

  if (!canRead) return <p role="alert" className="p-4 text-sm">No tiene permiso para consultar documentos fiscales.</p>;
  return <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
    <details className={panel}><summary className="cursor-pointer text-sm font-semibold text-accent-600">Validar estructura de un XML oficial (sin envío)</summary><div className="mt-4"><FiscalXmlValidationPanel /></div></details>
    <PageHeader eyebrow="Finanzas" title="Documentos fiscales"
      description="Revise el documento congelado, el resultado de simulación y sus evidencias privadas."
      actions={<><button type="button" className={button} disabled={busy || data.status === 'loading'} onClick={() => void load()}>Actualizar</button>
        {active && <button type="button" className={button + ' bg-accent-600 text-white'} disabled={busy} onClick={() => {
          ++selectionRequest.current; setForm({ key: selectionRequest.current, invoice: null, outcome: 'Accepted' }); setSelection(null); setDetailStatus('idle'); setError('');
        }}>Nueva simulación</button>}</>} />
    <div className="rounded-xl border border-status-warning/40 bg-status-warning/10 p-4">
      <p className="text-sm font-bold">SIMULACIÓN SIN VALIDEZ FISCAL</p>
      <p className="mt-1 text-sm">No emite comprobantes oficiales, firma digital, QR fiscal ni eNCF.</p>
      {data.config && <p className="mt-2 text-xs">Modo: {data.config.mode} · Ambiente: {data.config.environment}. Validación XSD oficial del documento: no realizada.</p>}
      {data.config?.mode === 'Off' && <p className="mt-2 text-sm">La simulación está desactivada. No se crean trabajos.</p>}
      {data.config?.mode === 'ProviderSandbox' && <p className="mt-2 text-sm">Sandbox bloqueado: proveedor y configuración pendientes.</p>}
    </div>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <label className="block max-w-xs text-xs font-semibold">Estación<select className={field} disabled={busy} value={stationId} onChange={event => {
      ++selectionRequest.current; setStationId(event.target.value); setSelection(null); setForm(null); setDetailStatus('idle');
    }}><option value="">Todas mis estaciones</option>{stations.map(station => <option key={station.stationId ?? station.id} value={station.stationId ?? station.id}>{station.stationCode ?? station.code}</option>)}</select></label>
    {data.status === 'loading' ? <p role="status" className="text-sm">Cargando documentos…</p> : data.status === 'error'
      ? <div className={panel}><p role="alert" className="text-sm text-status-danger">{data.error}</p><button type="button" className={button + ' mt-3'} onClick={() => void load()}>Reintentar carga</button></div>
      : <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(14rem,19rem)_minmax(0,1fr)]">
        <section aria-label="Documentos fiscales" className="space-y-2">
          {data.documents.length === 0 && <p className={panel + ' text-sm'}>No hay documentos fiscales para esta estación.</p>}
          {data.documents.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={selection?.id === item.id}
            onClick={() => void select(item.id)} className={panel + ' w-full text-left ' + (selection?.id === item.id ? 'border-accent-600' : '')}>
            <strong className="block break-all text-sm">Factura {item.invoiceId}</strong><span className="mt-2 block"><Badge state={item.state} /></span>
            <span className="mt-2 block text-xs">{formatMoney(item.total, item.currencyCode)} · {date(item.createdAt)}</span>
          </button>)}
        </section>
        <section className={panel} aria-label="Detalle fiscal" aria-busy={detailStatus === 'loading'}>
          {form && active ? <form onSubmit={create} className="space-y-4"><h2 className="font-bold">Nueva simulación fiscal</h2>
            <p className="text-sm">Seleccione una factura no fiscal emitida. El servidor conserva sus importes; la simulación no modifica la factura.</p>
            <FiscalInvoicePicker key={form.key} stationId={stationId} initialInvoiceId={initialInvoiceId} canRead={canReadInvoices}
              selected={form.invoice} onSelect={chooseInvoice} disabled={busy} />
            <label className="block text-xs font-semibold">Resultado a simular<select className={field} value={form.outcome} disabled={busy}
              onChange={event => setForm(previous => ({ ...previous, outcome: event.target.value }))}>{Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <button type="submit" disabled={busy || !canReadInvoices || !form.invoice} className={button + ' bg-accent-600 text-white'}>Crear simulación</button>
          </form> : detailStatus === 'loading' ? <p role="status" className="text-sm">Cargando detalle…</p>
            : detailStatus === 'error' ? <div><p role="alert" className="text-sm text-status-danger">{detailError}</p><button type="button" className={button + ' mt-3'} onClick={() => void select(selectedDocumentId.current)}>Reintentar detalle</button></div>
              : selection ? <FiscalDetail document={selection} active={active} busy={busy} onRefresh={() => void select(selection.id)}
                onSimulate={() => setConfirm(true)} onDownload={download} /> : <p className="text-sm">Seleccione un documento para revisar su estado y evidencias.</p>}
        </section>
      </div>}
    <ConfirmDialog open={confirm} title="Ejecutar simulación local" confirmLabel="Confirmar simulación" busy={busy} onClose={() => setConfirm(false)} onConfirm={() => void simulate()}
      description="Se archivarán los bytes originales antes de ejecutar una única simulación local. Un resultado desconocido requiere revisar el estado antes de actuar." />
  </div>;
}

const invoicePageSize = 25;
const invoiceLabel = invoice => `${invoice.number} · ${invoice.airline} · ${formatMoney(invoice.total, invoice.currencyCode)} · ${invoice.stationCode}`;
const normalizeSearch = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
function invoiceError(failure) {
  if (failure?.status === 401) return 'La sesión expiró. Vuelva a iniciar sesión.';
  if (failure?.status === 403) return 'No tiene permiso para consultar las facturas emitidas.';
  if (failure?.status === 404) return 'La factura no está disponible en sus estaciones.';
  return 'No se pudieron cargar las facturas emitidas. Intente de nuevo.';
}

function FiscalInvoicePicker({ stationId, initialInvoiceId, canRead, selected, onSelect, disabled }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [invoices, setInvoices] = useState(null);
  const [initial, setInitial] = useState({ status: initialInvoiceId ? 'loading' : 'idle' });
  const [initialRevision, setInitialRevision] = useState(0);
  const initialRequest = useRef(0);
  const term = normalizeSearch(search.trim());
  const ledgerPage = term ? 1 : page;
  const queryKey = JSON.stringify([stationId, term, ledgerPage, revision]);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    async function loadInvoices() {
      try {
        let nextPage = ledgerPage;
        let result;
        const matches = [];
        do {
          result = await listFinanceInvoices({ stationId, page: nextPage, limit: invoicePageSize });
          if (!active) return;
          matches.push(...result.invoices.filter(invoice => !term || normalizeSearch(`${invoiceLabel(invoice)} ${invoice.total}`).includes(term)));
          nextPage += 1;
          // The ledger has no text-search parameter; search all of its scoped pages.
        } while (term && result.hasMore);
        setInvoices({ key: queryKey, status: 'ready', rows: matches, hasMore: !term && result.hasMore });
      } catch (failure) {
        if (active) setInvoices({ key: queryKey, status: 'error', error: invoiceError(failure) });
      }
    }
    const timer = window.setTimeout(() => void loadInvoices(), term ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [canRead, stationId, term, ledgerPage, queryKey]);

  useEffect(() => {
    if (!canRead || !initialInvoiceId) return;
    const request = ++initialRequest.current;
    let active = true;
    getFinanceInvoice(initialInvoiceId).then(value => {
      if (!active || request !== initialRequest.current) return;
      if (stationId && value.summary.stationId !== stationId) {
        setInitial({ status: 'error', error: 'La factura inicial no está disponible en la estación seleccionada. Seleccione otra factura.' });
        return;
      }
      onSelect(value.summary); setInitial({ status: 'ready' });
    }, failure => {
      if (active && request === initialRequest.current) setInitial({ status: 'error', error: invoiceError(failure) });
    });
    return () => { active = false; };
  }, [canRead, initialInvoiceId, stationId, initialRevision, onSelect]);

  if (!canRead) return <p role="alert" className="text-sm text-status-danger">No tiene permiso para consultar las facturas emitidas.</p>;
  const current = invoices?.key === queryKey ? invoices : null;
  const loading = !current;
  const rows = current?.status === 'ready' ? (term ? current.rows.slice((page - 1) * invoicePageSize, page * invoicePageSize) : current.rows) : [];
  const hasMore = current?.status === 'ready' && (term ? page * invoicePageSize < current.rows.length : current.hasMore);
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="text-sm font-semibold">Factura emitida</legend>
    <label className="block text-xs font-semibold">Buscar facturas<input type="search" className={field} value={search}
      placeholder="Número, aerolínea o importe" onChange={event => { setSearch(event.target.value); setPage(1); }}
      onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
    {initial.status === 'loading' && <p role="status" className="text-sm">Cargando factura inicial…</p>}
    {initial.status === 'error' && <div><p role="alert" className="text-sm text-status-danger">{initial.error}</p>
      <button type="button" className={button + ' mt-2'} onClick={() => { setInitial({ status: 'loading' }); setInitialRevision(value => value + 1); }}>Reintentar factura inicial</button></div>}
    {selected && <p className="rounded-lg bg-accent-600/10 p-3 text-sm">Factura seleccionada: {invoiceLabel(selected)}</p>}
    {loading ? <p role="status" className="text-sm">{term ? 'Buscando facturas en sus estaciones…' : 'Cargando facturas emitidas…'}</p>
      : current.status === 'error' ? <div><p role="alert" className="text-sm text-status-danger">{current.error}</p>
        <button type="button" className={button + ' mt-2'} onClick={() => setRevision(value => value + 1)}>Reintentar facturas</button></div>
        : <>
          {rows.length === 0 ? <p className="text-sm">{term ? 'No hay facturas emitidas que coincidan con la búsqueda.' : 'No hay facturas emitidas para esta estación.'}</p>
            : <div className="max-h-80 space-y-2 overflow-y-auto" role="radiogroup" aria-label="Facturas emitidas">
              {rows.map(invoice => <label key={invoice.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
                <input type="radio" name="fiscal-invoice" className="mt-1 shrink-0" checked={selected?.id === invoice.id}
                  onChange={() => { ++initialRequest.current; setInitial({ status: 'ready' }); onSelect(invoice); }} />
                <span className="min-w-0 break-words">{invoiceLabel(invoice)}</span>
              </label>)}
            </div>}
        </>}
    <nav aria-label="Páginas de facturas" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <button type="button" className={button} aria-label="Página anterior de facturas" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
      <span>Página {page}</span>
      <button type="button" className={button} aria-label="Siguiente página de facturas" disabled={loading || !hasMore} onClick={() => setPage(value => value + 1)}>Siguiente</button>
    </nav>
  </fieldset>;
}

function FiscalDetail({ document: item, active, busy, onRefresh, onSimulate, onDownload }) {
  const uncertain = ['Unknown', 'Dispatching', 'Pending', 'Conditional'].includes(item.state);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">Documento de simulación</h2><span className="mt-2 block"><Badge state={item.state} /></span></div>
      <button type="button" className={button} disabled={busy} onClick={onRefresh}>Actualizar estado</button></div>
    {uncertain && <p className="rounded-lg bg-status-warning/10 p-3 text-sm">No reenvíe este documento. Actualice el estado y revise el historial para conciliar el resultado.</p>}
    {item.artifactCompletion !== 'Complete' && <p className="rounded-lg bg-status-warning/10 p-3 text-sm">Archivo incompleto: {item.artifactCompletion === 'Failed' ? 'falló la conservación o verificación de evidencias.' : 'faltan evidencias por archivar.'}
      {item.state === 'ArchiveBlocked' && ' El envío fue bloqueado antes de la simulación.'}</p>}
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      {[['ID interno', item.id], ['Factura', item.invoiceId], ['Importe congelado', formatMoney(item.total, item.currencyCode)], ['ID proveedor simulado', item.providerDocumentId ?? 'Sin asignar'],
        ['Respuesta DGII', item.dgiiResponseId ?? 'No disponible en simulación'], ['eNCF', item.encf ?? 'No disponible en simulación']].map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}
    </dl>
    <div><h3 className="text-sm font-bold">Archivo de evidencias</h3>{item.artifacts.length === 0 ? <p className="mt-2 text-sm">Aún no hay archivos conservados.</p>
      : <ul className="mt-2 space-y-2">{item.artifacts.map(artifact => <li key={artifact.id} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-sm">{artifact.fileName} · {artifact.length} bytes</span><button type="button" className={button} disabled={busy} onClick={() => void onDownload(artifact)}>Descargar {artifact.fileName}</button></div>
        <p className="mt-2 break-all text-xs text-text-secondary-light dark:text-text-secondary-dark">SHA-256: {artifact.sha256}</p>
      </li>)}</ul>}</div>
    <details><summary className="cursor-pointer text-sm font-semibold">Snapshot y hash financiero</summary><p className="mt-2 break-all text-xs">SHA-256: {item.snapshotHash}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/5 p-3 text-xs dark:bg-white/5">{item.canonicalSnapshot}</pre></details>
    <div><h3 className="text-sm font-bold">Historial</h3>{item.history.length === 0 ? <p className="mt-2 text-sm">Sin eventos.</p> : <ol className="mt-2 space-y-3">{item.history.map(event => <li key={event.id} className="border-l-2 border-accent-600/30 pl-3 text-sm">
      <span className="block text-xs text-text-secondary-light dark:text-text-secondary-dark">{date(event.occurredAt)} · {event.kind}{!event.applied && ' · Sin cambio de estado'}</span><p className="mt-1 break-words">{event.detail}</p>
    </li>)}</ol>}</div>
    {active && ['AwaitingArchive', 'ArchiveBlocked'].includes(item.state) && <button type="button" className={button + ' bg-accent-600 text-white'} disabled={busy} onClick={onSimulate}>
      {item.state === 'ArchiveBlocked' ? 'Reintentar archivo y simular' : 'Ejecutar simulación local'}</button>}
  </div>;
}
