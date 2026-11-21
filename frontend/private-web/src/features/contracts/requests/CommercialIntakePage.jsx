import { useCallback, useEffect, useRef, useState } from 'react';
import AirlineFleetFacts from '../../aviation-reference/AirlineFleetFacts';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import {
  cancelCommercialRequest, confirmCommercialRepresentative, decideCommercialRequest, getCommercialRequestInbox,
  getCommercialStations, getPublishedAirlineProfiles, verifyCommercialRequestAirline,
} from '../../../services/commercialGovernanceApi';
import { commercialRequestMessage } from '../../../services/commercialProblems';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { isConflict, isForbidden } from '../../../services/problemMessages';
import { airlineIdentityErrors, taxProblemMessage } from './airlineIdentity';
import { checkTaxRegistration, formatPhone, maskRnc, rncFeedback } from '@elevant/api-client';
import {
  BLOCKING_REGISTRY_STATUSES, countryName, documentLabel, registryVerdictLabel, requestReferenceLabel, requestStatusLabel,
} from './requestLabels';
import { representativeDomainCheck } from './representativeDomain';
import { billingUnitLabel } from '../../../services/billingUnits';

const PAGE_SIZE = 25;
const OPEN = ['Pending', 'InReview'];
const FILTERS = [['Open', 'Abiertas'], ['Pending', 'Pendientes'], ['InReview', 'En revisión'], ['Approved', 'Aprobadas'],
  ['Rejected', 'Rechazadas'], ['Cancelled', 'Canceladas'], ['All', 'Todas']];
const COUNTERS = [['Pending', 'pending', 'Pendientes'], ['InReview', 'inReview', 'En revisión'],
  ['Approved', 'approved', 'Aprobadas'], ['Rejected', 'rejected', 'Rechazadas'], ['Cancelled', 'cancelled', 'Canceladas']];
const LOAD_FAILED = 'No se pudieron cargar las solicitudes. Revisa la conexión e intenta de nuevo.';
const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark';
const dateTime = value => new Date(value).toLocaleString('es-DO');
// The identity form in its order; the constraints describe each field, airlineIdentity.js decides.
const IDENTITY_INPUTS = [
  { key: 'legalName', label: 'Razón social', required: true, maxLength: 200, wide: true },
  { key: 'countryCode', label: 'País (2 letras)', required: true, minLength: 2, maxLength: 2, pattern: '[A-Z]{2}', upper: true },
  { key: 'iataCode', label: 'IATA (opcional, 2 caracteres)', minLength: 2, maxLength: 2, pattern: '[A-Z0-9]{2}', upper: true },
  { key: 'icaoCode', label: 'ICAO (3 letras)', required: true, minLength: 3, maxLength: 3, pattern: '[A-Z]{3}', upper: true },
  { key: 'verificationSourceUrl', label: 'Fuente HTTPS', required: true, maxLength: 512, type: 'url', inputMode: 'url',
    pattern: 'https://.+', placeholder: 'https://', wide: true },
];

/**
 * Contratos inbox of the public requests (phase 1, block A): server filter, search and paging, the
 * counters per status, and the review of one request — airline verification, representative
 * confirmation, decision and cancellation. Every command carries its Idempotency-Key and the
 * request version on screen; a conflict re-reads the inbox.
 */
export default function CommercialIntakePage({ canVerify = true, canApprove = true, canReject = true, canCancel = false }) {
  const [filter, setFilter] = useState('Open');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // `key` names the filter, search and page the inbox belongs to.
  const [view, setView] = useState({ status: 'loading', inbox: null, error: '', key: '' });
  const [stations, setStations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState('');
  // Each «Actualizar» of the user: the open review drops an alert about the request as it was before.
  const [refreshes, setRefreshes] = useState(0);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const call = ++latest.current;
    const key = `${filter}|${search}|${page}`;
    try {
      const [inbox, nextStations] = await Promise.all([
        getCommercialRequestInbox({ status: filter, search, page, limit: PAGE_SIZE }), getCommercialStations()]);
      if (call !== latest.current) return;
      setStations(nextStations);
      setView({ status: 'ready', inbox, error: '', key });
    } catch (failure) {
      if (call !== latest.current) return;
      if (isForbidden(failure)) {
        setView({ status: 'forbidden', inbox: null, error: '', key });
        return;
      }
      const error = commercialRequestMessage(failure, { fallback: LOAD_FAILED });
      // A failed refresh keeps its list with an alert; a list that never loaded is never shown as «vacío».
      setView(current => current.inbox && current.key === key
        ? { ...current, status: 'ready', error }
        : { status: 'error', inbox: null, error, key });
    }
  }, [filter, search, page]);
  useEffect(() => { void reload(); }, [reload]);
  useCommercialRevalidation(reload);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('commercial_requests')) void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);

  // A new filter, search or page shows «Cargando» in the list; the open review stays on screen.
  const changeQuery = useCallback(next => {
    const nextFilter = next.filter ?? filter;
    const nextSearch = next.search ?? search;
    const nextPage = next.page ?? 1;
    if (nextFilter === filter && nextSearch === search && nextPage === page) return;
    setView(current => ({ ...current, status: 'loading', error: '' }));
    setFilter(nextFilter);
    setSearch(nextSearch);
    setPage(nextPage);
  }, [filter, search, page]);
  // The search runs on the server shortly after typing stops.
  useEffect(() => {
    const term = searchInput.trim();
    if (term === search) return undefined;
    const timer = setTimeout(() => changeQuery({ search: term }), 350);
    return () => clearTimeout(timer);
  }, [searchInput, search, changeQuery]);

  const completed = useCallback(async message => {
    setNotice(message);
    await reload();
  }, [reload]);
  const inbox = view.inbox;
  const requests = inbox?.requests ?? [];
  const selected = requests.find(item => item.id === selectedId) ?? null;
  const pages = inbox ? Math.max(1, Math.ceil(inbox.total / PAGE_SIZE)) : 1;
  const permissions = { canVerify, canApprove, canReject, canCancel };

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Entrada pública</p><h1 className="mt-1 text-2xl font-bold">Solicitudes</h1><p className="mt-1 text-sm text-text-secondary-light">Verifica aerolínea y representante antes de aceptar los servicios. La aprobación crea un borrador.</p></div><button type="button" onClick={() => { setRefreshes(current => current + 1); void reload(); }} className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10">Actualizar</button></header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {view.status === 'forbidden' ? <p role="alert" className="rounded-xl border border-status-danger/30 bg-white p-8 text-center text-sm dark:bg-surface-dark-card">No tienes permiso para ver las solicitudes comerciales. Pide acceso al administrador de Contratos.</p> : <>
      {inbox && <div role="group" aria-label="Solicitudes por estado" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{COUNTERS.map(([status, key, label]) =>
        <button type="button" key={status} onClick={() => { setSelectedId(null); changeQuery({ filter: status }); }} aria-pressed={filter === status} className={`rounded-xl border p-3 text-left ${filter === status ? 'border-accent-600 bg-accent-600/[.06]' : 'border-black/5 bg-white dark:bg-surface-dark-card'}`}><span className="block text-xs text-text-secondary-light">{label}</span><strong className="text-xl">{inbox.counts[key]}</strong></button>)}</div>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_470px]">
        <section className="overflow-hidden rounded-xl border border-black/5 bg-white dark:bg-surface-dark-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-black/5 p-4 dark:border-white/5">
            <label className="text-xs font-semibold">Estado<select value={filter} onChange={event => { setSelectedId(null); changeQuery({ filter: event.target.value }); }} className="ml-2 rounded-lg border border-black/10 bg-white px-2 py-2 text-sm dark:bg-surface-dark">{FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <form role="search" className="flex min-w-0 flex-1" onSubmit={event => { event.preventDefault(); changeQuery({ search: searchInput.trim() }); }}><input type="search" aria-label="Buscar solicitudes" placeholder="Buscar aerolínea, referencia, representante o correo" maxLength={100} value={searchInput} onChange={event => setSearchInput(event.target.value)} className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark" /></form>
            {inbox && view.status === 'ready' && <span className="whitespace-nowrap text-xs text-text-secondary-light">{inbox.total} {inbox.total === 1 ? 'solicitud' : 'solicitudes'}</span>}
          </div>
          {view.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-status-danger/20 bg-status-danger/10 p-3 text-sm text-status-danger"><span>{view.error}</span><button type="button" onClick={() => { void reload(); }} className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button></div>}
          {view.status === 'loading' ? <p className="p-6 text-sm">Cargando solicitudes…</p>
            : view.status === 'error' ? <p className="p-8 text-center text-sm text-text-secondary-light">La bandeja no está disponible por ahora.</p>
              : requests.length ? <div className="divide-y divide-black/5 dark:divide-white/5">{requests.map(item => {
                const reference = requestReferenceLabel(item.reference, { list: true });
                return <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-accent-600/[.04] ${selectedId === item.id ? 'bg-accent-600/[.07]' : ''}`}><span><strong className="block text-sm">{item.airline}</strong><span className="mt-1 block text-xs text-text-secondary-light">{item.representativeName} · <EmailAddress value={item.representativeEmail} /></span><span className="mt-1 block font-mono text-[11px] text-text-secondary-light"><span title={reference.title}>{reference.text}</span> · {dateTime(item.submittedAt)}</span></span><span className="flex flex-wrap items-center gap-2">{item.proposedAirline && !item.airlineProfileId && <span className="rounded-full bg-status-warning/10 px-2.5 py-1 text-xs font-semibold">Aerolínea propuesta</span>}<span className="rounded-full bg-accent-600/10 px-2.5 py-1 text-xs font-semibold text-accent-600">{requestStatusLabel(item.status)}</span></span></button>;
              })}</div>
                : <p className="p-8 text-center text-sm text-text-secondary-light">No hay solicitudes con este filtro.</p>}
          {inbox && view.status === 'ready' && inbox.total > PAGE_SIZE && <div className="flex items-center justify-between gap-3 border-t border-black/5 p-3 text-xs dark:border-white/5"><button type="button" disabled={page <= 1} onClick={() => changeQuery({ page: page - 1 })} className="rounded-lg border border-black/10 px-3 py-1 disabled:opacity-50">Anterior</button><span>Página {page} de {pages}</span><button type="button" disabled={!inbox.hasMore} onClick={() => changeQuery({ page: page + 1 })} className="rounded-lg border border-black/10 px-3 py-1 disabled:opacity-50">Siguiente</button></div>}
        </section>
        <section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">{selected ? <RequestReview key={selected.id} request={selected} stations={stations} permissions={permissions} onCompleted={completed} onRefresh={reload} refreshes={refreshes} /> : <div className="py-12 text-center"><h2 className="font-bold">Selecciona una solicitud</h2><p className="mt-2 text-sm text-text-secondary-light">Aquí verás la aerolínea, el representante y los servicios solicitados.</p></div>}</section>
      </div>
    </>}
  </div>;
}

function RequestReview({ request, stations, permissions, onCompleted, onRefresh, refreshes = 0 }) {
  const open = OPEN.includes(request.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A refusal describes the request as it was: the user's «Actualizar» or a manual verification by Superadministración
  // (what unblocks `airline_not_in_public_registry`) makes it stale. The re-read after a conflict keeps it on screen.
  const freshness = `${refreshes}|${request.manualVerification ? 'manual' : ''}`;
  const [seenFreshness, setSeenFreshness] = useState(freshness);
  if (seenFreshness !== freshness) {
    setSeenFreshness(freshness);
    setError('');
  }
  const verifyKeys = useRef(createCommandKeyHolder());
  const confirmKeys = useRef(createCommandKeyHolder());
  const decideKeys = useRef(createCommandKeyHolder());
  const cancelKeys = useRef(createCommandKeyHolder());

  async function run(holder, action, body, send, success) {
    setBusy(true); setError('');
    try {
      await holder.current.run(action, body, key => send(key));
      await onCompleted(success);
      return true;
    } catch (failure) {
      setError(commercialRequestMessage(failure));
      if (isConflict(failure)) await onRefresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  const verify = (command, success) => run(verifyKeys, 'verify', { id: request.id, ...command },
    key => verifyCommercialRequestAirline(request.id, command, key), success);
  const confirm = note => run(confirmKeys, 'confirm', { id: request.id, note },
    key => confirmCommercialRepresentative(request.id, { expectedVersion: request.version, note }, key),
    'Confirmación del representante registrada. La solicitud está en revisión.');
  const decide = command => run(decideKeys, 'decide', { id: request.id, ...command },
    key => decideCommercialRequest(request.id, command, key),
    command.approve ? 'Solicitud aprobada. Se creó un contrato en borrador y el superadministrador recibió la tarea de crear la cuenta. Quedó en cola un correo al solicitante.'
      : 'Solicitud rechazada. Quedó en cola un correo al solicitante con el motivo.');
  const cancel = reason => run(cancelKeys, 'cancel', { id: request.id, reason },
    key => cancelCommercialRequest(request.id, { expectedVersion: request.version, reason }, key),
    'Solicitud cancelada. Quedó en cola un correo al solicitante con el motivo.');

  return <div className="space-y-5">
    <div><p className="break-all text-xs font-mono text-signal-500">{requestReferenceLabel(request.reference).text}</p><h2 className="mt-1 text-xl font-bold">{request.airline}</h2><p className="text-xs text-text-secondary-light">{requestStatusLabel(request.status)} · Recibida el {dateTime(request.submittedAt)}</p></div>
    {open && request.existingCustomer && <p role="note" className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs">La aerolínea ya tiene un contrato vigente o en curso, o cuentas activas en el portal. No admite una segunda afiliación: amplía los servicios con una enmienda o una renovación de su contrato, o cancela esta solicitud.</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <AirlineSection request={request} canVerify={permissions.canVerify && open} busy={busy} onVerify={verify} />
    <RegistrySection request={request} open={open} />
    <RepresentativeSection request={request} canConfirm={permissions.canVerify && open} busy={busy} onConfirm={confirm} />
    <div><h3 className="text-sm font-bold">Servicios solicitados</h3><ul className="mt-2 space-y-1">{request.services.map((service, index) => <li key={`${service.serviceId}-${index}`} className="rounded bg-accent-600/[.06] px-3 py-2 text-sm">{service.name} <span className="text-xs text-text-secondary-light">· por {billingUnitLabel(service.unit)}</span></li>)}</ul></div>
    {open && (permissions.canApprove || permissions.canReject) && <DecisionSection request={request} stations={stations} canApprove={permissions.canApprove} canReject={permissions.canReject} busy={busy} onDecide={decide} />}
    {open && permissions.canCancel && <CancelSection busy={busy} onCancel={cancel} />}
    {!open && <p className="rounded-lg bg-black/[.04] p-4 text-sm dark:bg-white/[.04]">Estado: {requestStatusLabel(request.status)}{request.cancelledAt && ` el ${dateTime(request.cancelledAt)}`}{request.decisionReason && ` · ${request.decisionReason}`}{request.contractId && ' · Se creó un contrato en borrador'}</p>}
  </div>;
}

function Detail({ label, children }) {
  return <div><dt className="text-xs text-text-secondary-light">{label}</dt><dd className="break-words">{children}</dd></div>;
}

/** An email that wraps before its «@» when it does not fit (N35), never in the middle of a word. */
function EmailAddress({ value }) {
  const at = typeof value === 'string' ? value.lastIndexOf('@') : -1;
  return at > 0 ? <>{value.slice(0, at)}<wbr />{value.slice(at)}</> : value;
}

function AirlineSection({ request, canVerify, busy, onVerify }) {
  const proposal = request.proposedAirline;
  const linked = Boolean(request.airlineProfileId);
  // Who verified the identity (N35): Superadministración by hand, as the API reports. Otherwise the inbox cannot tell
  // Contratos from a superadministrator who lost the role since (manualVerification follows the current role), so the
  // title names no one.
  const identityTitle = !request.airlineVerified ? 'Identidad legal pendiente de verificación'
    : request.manualVerification ? 'Identidad verificada a mano por Superadministración' : 'Identidad verificada';
  const [mode, setMode] = useState('create');
  const [editing, setEditing] = useState(!request.airlineVerified);
  // What the applicant proposed fills the form until Contratos confirms it; its website is only a starting source.
  const [identity, setIdentity] = useState({
    legalName: request.legalName ?? proposal?.name ?? '', countryCode: request.countryCode ?? proposal?.countryCode ?? '',
    iataCode: request.iataCode ?? proposal?.iataCode ?? '', icaoCode: request.icaoCode ?? proposal?.icaoCode ?? '',
    verificationSourceUrl: request.verificationSourceUrl
      ?? (proposal?.websiteUrl?.startsWith('https://') ? proposal.websiteUrl : ''),
  });
  // The airline's tax identifier (an RNC when it is Dominican, shown with its dashes); Contratos may correct it.
  const [tax, setTax] = useState(() => {
    const countryCode = request.taxRegistration?.countryCode ?? request.countryCode ?? proposal?.countryCode ?? '';
    const number = request.taxRegistration?.number ?? '';
    return { number: countryCode === 'DO' ? maskRnc(number) : number, countryCode };
  });
  const [catalog, setCatalog] = useState({ status: 'idle', airlines: [], error: '' });
  const [profileId, setProfileId] = useState('');
  // After a refused submit the messages follow the typing; `attempt` moves the focus to the first one.
  const [checked, setChecked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef(null);
  const chosen = catalog.airlines.find(item => item.id === profileId) ?? null;
  const linking = !linked && mode === 'link';
  const needsIdentity = !linking || (chosen !== null && !chosen.isVerified);
  const catalogEmpty = catalog.status === 'ready' && catalog.airlines.length === 0;
  // Left empty, the request keeps the identifier it has (older requests may have none).
  const taxCheck = tax.number.trim() ? checkTaxRegistration(tax.number, tax.countryCode) : null;
  const errors = { ...(checked && needsIdentity ? airlineIdentityErrors(identity) : {}),
    ...(checked && taxCheck?.problem ? { taxRegistration: taxProblemMessage(taxCheck.problem) } : {}) };
  useEffect(() => {
    if (attempt) formRef.current?.querySelector('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  async function loadCatalog() {
    setCatalog(current => ({ ...current, status: 'loading', error: '' }));
    try {
      const airlines = await getPublishedAirlineProfiles();
      setCatalog({ status: 'ready', airlines, error: '' });
      // Nothing published to link to: the request gets its own verified profile (1-N25).
      if (!airlines.length) setMode('create');
    } catch (failure) {
      setCatalog({ status: 'error', airlines: [], error: commercialRequestMessage(failure, {
        fallback: 'No se pudo cargar el catálogo de aerolíneas. Revisa la conexión e intenta de nuevo.' }) });
    }
  }
  function chooseMode(next) {
    setMode(next);
    if (next === 'link' && catalog.status === 'idle') void loadCatalog();
  }
  function close() {
    setEditing(false);
    setChecked(false);
  }
  async function submit(event) {
    event.preventDefault();
    // The identity is explained here, field by field: the api-client would refuse it without sending it.
    if (needsIdentity && Object.keys(airlineIdentityErrors(identity)).length || taxCheck?.problem) {
      setChecked(true);
      setAttempt(current => current + 1);
      return;
    }
    const command = { expectedVersion: request.version, ...(linking ? { linkProfileId: profileId } : {}),
      ...(needsIdentity ? identity : {}),
      ...(taxCheck?.registration ? { taxRegistration: taxCheck.registration.number,
        taxRegistrationCountryCode: taxCheck.registration.countryCode } : {}) };
    const saved = await onVerify(command, linking
      ? 'Aerolínea verificada y vinculada a la ficha del catálogo. La solicitud está en revisión.'
      : 'Aerolínea verificada. La solicitud está en revisión.');
    if (saved) close();
  }

  return <div className="space-y-3">
    {proposal && <div className="rounded-lg border border-status-warning/40 bg-status-warning/[.06] p-4 text-sm"><strong>Aerolínea propuesta por el solicitante</strong><p className="mt-1 text-xs text-text-secondary-light">No figuraba en el catálogo público. {linked ? 'Contratos ya la vinculó a una ficha del catálogo.' : 'Verifícala con una fuente oficial: crea su ficha o vincúlala a una existente.'}</p><dl className="mt-2 grid grid-cols-2 gap-2"><Detail label="Nombre">{proposal.name}</Detail><Detail label="País">{countryName(proposal.countryCode) ?? 'Sin dato'}</Detail><Detail label="IATA">{proposal.iataCode ?? 'Sin IATA'}</Detail><Detail label="ICAO">{proposal.icaoCode}</Detail>{proposal.websiteUrl && <Detail label="Sitio web">{proposal.websiteUrl}</Detail>}</dl></div>}
    {linked && <div className="rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]"><strong>{identityTitle}</strong><dl className="mt-2 grid grid-cols-2 gap-2"><Detail label="Razón social">{request.legalName ?? 'Sin confirmar'}</Detail><Detail label="País">{countryName(request.countryCode) ?? 'Sin confirmar'}</Detail><Detail label="IATA">{request.iataCode ?? (request.airlineVerified ? 'No tiene' : 'Sin confirmar')}</Detail><Detail label="ICAO">{request.icaoCode ?? 'Sin confirmar'}</Detail>{request.verificationSourceUrl && <Detail label="Fuente">{request.verificationSourceUrl}</Detail>}</dl></div>}
    <dl className="rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]"><Detail label="Identificación fiscal">{request.taxRegistration?.display ?? 'Sin registrar en la solicitud'}</Detail></dl>
    <AirlineFleetFacts icaoCode={request.icaoCode ?? proposal?.icaoCode} iataCode={request.iataCode ?? proposal?.iataCode} auto className="rounded-lg border border-black/10 p-3 dark:border-white/10" />
    {canVerify && !editing && <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-accent-600 underline">Corregir la verificación</button>}
    {canVerify && editing && <form ref={formRef} noValidate onSubmit={submit} className="border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-bold">Verificar identidad de la aerolínea</h3><p className="mt-1 text-xs text-text-secondary-light">Completa los datos con una fuente oficial. La lista histórica de clientes por sí sola no acredita razón social ni códigos. El ICAO es obligatorio; el IATA, solo si la aerolínea lo tiene.</p>
      {!linked && <fieldset className="mt-3 flex flex-wrap gap-4 text-sm"><legend className="sr-only">Cómo registrar la aerolínea</legend><label className="flex items-center gap-2"><input type="radio" name={`airline-mode-${request.id}`} checked={mode === 'create'} onChange={() => chooseMode('create')} />Crear ficha verificada</label><label className="flex items-center gap-2"><input type="radio" name={`airline-mode-${request.id}`} checked={mode === 'link'} disabled={catalogEmpty} onChange={() => chooseMode('link')} />Vincular a una ficha existente</label></fieldset>}
      {!linked && catalogEmpty && <p role="status" className="mt-2 text-xs text-text-secondary-light">No hay fichas publicadas en el catálogo para vincular. Crea una ficha verificada con los datos de la fuente oficial.</p>}
      {linking && <div className="mt-3">{catalog.status === 'loading' ? <p className="text-xs">Cargando aerolíneas…</p> : catalog.status === 'error' ? <p role="alert" className="text-xs text-status-danger">{catalog.error} <button type="button" onClick={() => { void loadCatalog(); }} className="font-semibold underline">Reintentar</button></p> : <label className="text-xs font-semibold">Ficha del catálogo<select required value={profileId} onChange={event => setProfileId(event.target.value)} className={field}><option value="">Selecciona la aerolínea</option>{catalog.airlines.map(item => <option key={item.id} value={item.id}>{item.name}{item.icaoCode ? ` · ${item.icaoCode}` : ''}{item.isVerified ? ' · verificada' : ''}</option>)}</select></label>}{chosen?.isVerified && <p className="mt-2 text-xs text-text-secondary-light">La ficha ya está verificada: se vinculará sin cambiar su identidad.</p>}</div>}
      {needsIdentity && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{IDENTITY_INPUTS.map(({ key, label, wide, upper, ...constraints }) => {
        const id = `airline-${request.id}-${key}`;
        const message = errors[key];
        return <div key={key} className={wide ? 'sm:col-span-2' : undefined}><label htmlFor={id} className="text-xs font-semibold">{label}</label><input id={id} name={key} {...constraints} value={identity[key]} aria-invalid={message ? true : undefined} aria-describedby={message ? `${id}-error` : undefined} onChange={event => setIdentity(current => ({ ...current, [key]: upper ? event.target.value.toUpperCase() : event.target.value }))} className={field} />{message && <p id={`${id}-error`} className="mt-1 text-xs text-status-danger">{message}</p>}</div>;
      })}</div>}
      <TaxFields id={`airline-${request.id}`} tax={tax} error={errors.taxRegistration} onChange={changes => setTax(current => ({ ...current, ...changes }))} />
      <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy || (linking && !profileId)} className="rounded-lg border border-accent-600 px-4 py-2 text-xs font-semibold text-accent-600 disabled:opacity-50">{linking ? 'Vincular y verificar' : 'Guardar verificación'}</button>{request.airlineVerified && <button type="button" onClick={close} className="rounded-lg px-4 py-2 text-xs">Descartar cambios</button>}</div>
    </form>}
  </div>;
}

/** The airline's tax identifier in the verification form: an RNC for a Dominican airline, otherwise its own id. */
function TaxFields({ id, tax, error, onChange }) {
  const dominican = tax.countryCode.trim().toUpperCase() === 'DO';
  // An RNC is typed with its mask and, with its 9 digits, is confirmed at once (no check digit).
  const feedback = dominican && !error ? rncFeedback(tax.number) : null;
  const described = [error && `${id}-taxNumber-error`, feedback && `${id}-taxNumber-feedback`].filter(Boolean).join(' ');
  return <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
    <div><label htmlFor={`${id}-taxCountry`} className="text-xs font-semibold">País del identificador fiscal (2 letras)</label><input id={`${id}-taxCountry`} maxLength={2} value={tax.countryCode} onChange={event => { const countryCode = event.target.value.toUpperCase(); onChange({ countryCode, ...(countryCode === 'DO' ? { number: maskRnc(tax.number) } : {}) }); }} className={field} /></div>
    <div><label htmlFor={`${id}-taxNumber`} className="text-xs font-semibold">{dominican ? 'RNC' : 'Identificador fiscal'}</label><input id={`${id}-taxNumber`} maxLength={dominican ? 12 : 32} inputMode={dominican ? 'numeric' : undefined} placeholder={dominican ? '1-31-23456-9' : undefined} value={tax.number} aria-invalid={error ? true : undefined} aria-describedby={described || undefined} onChange={event => onChange({ number: dominican ? maskRnc(event.target.value) : event.target.value })} className={field} />{error && <p id={`${id}-taxNumber-error`} className="mt-1 text-xs text-status-danger">{error}</p>}{feedback && <p id={`${id}-taxNumber-feedback`} role="status" className="mt-1 text-xs font-semibold text-status-success">✓ {feedback.message}</p>}</div>
  </div>;
}

/**
 * The public-registry check of the airline (ADR-0023) in plain Spanish, and the Superadmin exception: an airline
 * the registries do not confirm is approved only after Superadministración verifies it by hand with a source. Such an
 * approval asks no registry (DecideCommercialRequestHandler), so the section says who verified it, when and with which
 * source, shown as it is and never called official (N35, D-N35).
 */
function RegistrySection({ request, open }) {
  const check = request.registryCheck;
  const manual = request.manualVerification;
  const blocked = BLOCKING_REGISTRY_STATUSES.includes(check?.status);
  return <div className="rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]"><strong>Registros públicos</strong>
    {check ? <p className="mt-1">{registryVerdictLabel(check)} <span className="text-xs text-text-secondary-light">· {check.fromCatalog ? 'comprobación de Superadministración' : 'comprobación automática'} del {dateTime(check.checkedAt)}</span></p>
      : !manual && <p className="mt-1 text-xs text-text-secondary-light">{open ? 'Se comprobará automáticamente al aprobar.' : 'No se consultó a los registros públicos.'}</p>}
    {manual && <p className="mt-2 break-words rounded-lg bg-status-success/10 p-2 text-xs">✓ Verificada a mano por Superadministración el {dateTime(manual.verifiedAt)} · fuente {manual.verificationSourceUrl ?? 'sin dirección'}</p>}
    {open && manual && <p className="mt-1 text-xs text-text-secondary-light">Al aprobar no se consulta a los registros públicos.</p>}
    {open && blocked && !manual && <p role="note" className="mt-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-2 text-xs">No se puede aprobar mientras los registros públicos no la confirmen. Superadministración debe verificarla a mano con una fuente oficial en Superadministración › Aerolíneas; luego actualiza esta solicitud y apruébala.</p>}
    {open && check?.status === 'Unavailable' && !manual && <p role="note" className="mt-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-2 text-xs">Ningún registro público respondió. Puedes aprobar, pero confirma la aerolínea con su fuente oficial.</p>}
  </div>;
}

function RepresentativeSection({ request, canConfirm, busy, onConfirm }) {
  const [note, setNote] = useState('');
  const check = representativeDomainCheck(request.representativeEmail,
    [request.airlineWebsiteUrl, request.proposedAirline?.websiteUrl]);
  const confirmation = request.representativeConfirmation;
  const details = [
    ['Nacionalidad', countryName(request.representativeNationalityCode)],
    ['Documento', request.representativeDocumentType && request.representativeDocumentNumber
      ? `${documentLabel(request.representativeDocumentType)} · ${request.representativeDocumentNumber}` : null],
    ['Dirección', request.representativeAddress],
    ['País', request.representativeCountry],
    ['Provincia', request.representativeProvince],
    ['Municipio', request.representativeMunicipality],
    ['Distrito municipal', request.representativeDistrict],
  ].filter(([, value]) => value);
  async function submit(event) {
    event.preventDefault();
    if (await onConfirm(note.trim())) setNote('');
  }
  return <div className="space-y-3">
    <div className="rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]"><strong>Representante legal</strong><dl className="mt-2 grid grid-cols-2 gap-2"><Detail label="Nombre">{request.representativeName}</Detail><Detail label="Cargo">{request.representativeTitle}</Detail><Detail label="Correo"><EmailAddress value={request.representativeEmail} /></Detail><Detail label="Teléfono">{formatPhone(request.representativePhone) || 'Sin dato'}</Detail>{details.map(([label, value]) => <Detail key={label} label={label}>{value}</Detail>)}</dl><p className="mt-2 text-xs">{request.authorityDeclared ? '✓ Declaró autorización para representar a la aerolínea.' : 'No declaró autorización.'}</p></div>
    {check.kind === 'mismatch' && <p role="note" className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-xs">El dominio del correo ({check.emailDomain}) no coincide con el sitio oficial de la aerolínea ({check.site}). Confirma al representante por un canal oficial de la aerolínea antes de aprobar.</p>}
    {check.kind === 'match' && <p className="text-xs text-text-secondary-light">El dominio del correo coincide con el sitio oficial de la aerolínea ({check.site}).</p>}
    {check.kind === 'unknown' && <p className="text-xs text-text-secondary-light">No hay un sitio oficial de la aerolínea con el cual comparar el dominio del correo.</p>}
    {confirmation ? <p className="rounded-lg bg-status-success/10 p-3 text-xs">✓ Representante confirmado por {confirmation.confirmedBy || 'Contratos'} el {dateTime(confirmation.confirmedAt)}: {confirmation.note}</p>
      : canConfirm ? <form onSubmit={submit} className="border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-bold">Confirmar al representante</h3><p className="mt-1 text-xs text-text-secondary-light">Confírmalo por un canal oficial de la aerolínea (central telefónica, correo corporativo, carta firmada) y anota quién respondió y cómo. Sin esta confirmación no se puede aprobar.</p><label className="mt-3 block text-xs font-semibold">Cómo se confirmó<textarea required minLength={5} maxLength={1000} rows={3} value={note} onChange={event => setNote(event.target.value)} className={field} /></label><button disabled={busy || note.trim().length < 5} className="mt-2 rounded-lg border border-accent-600 px-4 py-2 text-xs font-semibold text-accent-600 disabled:opacity-50">Registrar confirmación</button></form>
        : <p className="text-xs text-text-secondary-light">Representante pendiente de confirmación por Contratos.</p>}
  </div>;
}

function DecisionSection({ request, stations, canApprove, canReject, busy, onDecide }) {
  const [stationIds, setStationIds] = useState([]);
  const [reason, setReason] = useState('');
  const confirmed = Boolean(request.representativeConfirmation);
  const manual = Boolean(request.manualVerification);
  const ready = request.airlineVerified && confirmed && request.authorityDeclared && !request.existingCustomer;
  // N35: the source is whatever the verifier recorded (OpenFlights too), so the list never calls it official; an
  // airline verified by hand is approved without asking the registries.
  const checklist = [
    [request.airlineVerified, 'Identidad de la aerolínea verificada con su fuente'],
    [confirmed, 'Representante confirmado por Contratos'],
    [request.authorityDeclared, 'Autorización declarada por el representante'],
    [!request.existingCustomer, 'La aerolínea no tiene un contrato vigente ni cuentas activas'],
    manual ? [true, 'Verificada a mano por Superadministración (al aprobar no se consulta a los registros públicos)']
      : [!BLOCKING_REGISTRY_STATUSES.includes(request.registryCheck?.status),
        'Confirmada en registros públicos o verificada a mano por Superadministración (se comprueba al aprobar)'],
    [stationIds.length > 0, 'Al menos una estación elegida'],
  ];
  return <div className="border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-bold">Decisión contractual</h3><p className="mt-1 text-xs text-text-secondary-light">Al aprobar se crea un contrato y versión en borrador. La operación requiere activación posterior. El solicitante recibe un correo con la decisión.</p>
    {canApprove && <><ul className="mt-3 space-y-1 text-xs">{checklist.map(([met, label]) => <li key={label}>{met ? '✓' : '○'} {label}</li>)}</ul>
      <fieldset className="mt-3"><legend className="text-xs font-semibold">Estaciones solicitadas para el borrador</legend>{stations.length ? stations.map(station => <label key={station.id} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={stationIds.includes(station.id)} onChange={event => setStationIds(current => event.target.checked ? [...current, station.id] : current.filter(id => id !== station.id))} />{station.code} · {station.name}</label>)
        : <p className="mt-2 rounded-lg bg-status-warning/10 p-3 text-xs">No hay estaciones activas para el borrador. Pide a Operaciones que active una.</p>}</fieldset>
      <button type="button" disabled={busy || !ready || !stationIds.length} onClick={() => { void onDecide({ approve: true, stationIds, expectedVersion: request.version }); }} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Aprobar y crear borrador</button></>}
    {canReject && <><label className="mt-4 block text-xs font-semibold">Motivo de rechazo<textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={1000} className={field} /></label><button type="button" disabled={busy || !reason.trim()} onClick={async () => { if (await onDecide({ approve: false, reason: reason.trim(), stationIds: [], expectedVersion: request.version })) setReason(''); }} className="mt-2 rounded-lg border border-status-danger px-4 py-2 text-xs font-semibold text-status-danger disabled:opacity-50">Rechazar solicitud</button></>}
  </div>;
}

function CancelSection({ busy, onCancel }) {
  const [reason, setReason] = useState('');
  return <div className="border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-bold">Cancelar la solicitud</h3><p className="mt-1 text-xs text-text-secondary-light">Para duplicados o solicitudes que el representante retiró. La solicitud se conserva como cancelada y el solicitante recibe el motivo por correo.</p><label className="mt-3 block text-xs font-semibold">Motivo de cancelación<textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} minLength={5} maxLength={1000} className={field} /></label><button type="button" disabled={busy || reason.trim().length < 5} onClick={async () => { if (await onCancel(reason.trim())) setReason(''); }} className="mt-2 rounded-lg border border-black/20 px-4 py-2 text-xs font-semibold disabled:opacity-50 dark:border-white/20">Cancelar solicitud</button></div>;
}
