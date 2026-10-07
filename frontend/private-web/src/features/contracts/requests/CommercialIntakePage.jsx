import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { decideCommercialRequest, getCommercialRequests, getCommercialStations, verifyCommercialAirline } from '../../../services/commercialGovernanceApi';

const labels = { Pending: 'Pendiente', InReview: 'En revisión', Approved: 'Aprobada', Rejected: 'Rechazada', Cancelled: 'Cancelada' };

export default function CommercialIntakePage({ canVerify = true, canApprove = true, canReject = true }) {
  const [requests, setRequests] = useState([]);
  const [stations, setStations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const reload = useCallback(async () => {
    try {
      const [items, availableStations] = await Promise.all([getCommercialRequests(), getCommercialStations()]);
      setRequests(items); setStations(availableStations); setStatus('ready'); setError('');
    } catch (failure) { setStatus('error'); setError(failure.message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useCommercialRevalidation(reload);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('commercial_requests')) void reload();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [reload]);
  const selected = requests.find(item => item.id === selectedId) ?? null;
  const visible = useMemo(() => requests.filter(item =>
    `${item.reference} ${item.airline} ${item.representativeEmail}`.toLocaleLowerCase('es')
      .includes(query.toLocaleLowerCase('es').trim())), [requests, query]);
  async function act(action, message) {
    setError(''); setNotice('');
    try { await action(); setNotice(message); await reload(); return true; }
    catch (failure) { setError(failure.message); return false; }
  }
  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-signal-500">Gestión contractual / Entrada pública</p><h1 className="mt-1 text-2xl font-bold">Solicitudes</h1><p className="mt-1 text-sm text-text-secondary-light">Verifique aerolínea y representante antes de aceptar los servicios. La aprobación crea un borrador.</p></div><button type="button" onClick={reload} className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10">Actualizar</button></header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_470px]">
      <section className="overflow-hidden rounded-xl border border-black/5 bg-white dark:bg-surface-dark-card"><div className="flex items-center justify-between gap-3 border-b border-black/5 p-4 dark:border-white/5"><input type="search" aria-label="Buscar solicitudes" placeholder="Buscar aerolínea, referencia o correo" value={query} onChange={event => setQuery(event.target.value)} className="w-full max-w-lg rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark" /><span className="whitespace-nowrap text-xs text-text-secondary-light">{visible.length} solicitudes</span></div>
        {status === 'loading' ? <p className="p-6 text-sm">Cargando solicitudes…</p> : visible.length ? <div className="divide-y divide-black/5 dark:divide-white/5">{visible.map(item => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-accent-600/[.04] ${selectedId === item.id ? 'bg-accent-600/[.07]' : ''}`}><span><strong className="block text-sm">{item.airline}</strong><span className="mt-1 block text-xs text-text-secondary-light">{item.representativeName} · {item.representativeEmail}</span><span className="mt-1 block font-mono text-[11px] text-text-secondary-light">{item.reference.slice(0, 16)} · {new Date(item.submittedAt).toLocaleString('es-DO')}</span></span><span className="rounded-full bg-accent-600/10 px-2.5 py-1 text-xs font-semibold text-accent-600">{labels[item.status] ?? item.status}</span></button>)}</div> : <p className="p-8 text-center text-sm text-text-secondary-light">No hay solicitudes con este filtro.</p>}
      </section>
      <section className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">{selected ? <RequestReview key={selected.id} request={selected} stations={stations} act={act} canVerify={canVerify} canApprove={canApprove} canReject={canReject} /> : <div className="py-12 text-center"><h2 className="font-bold">Seleccione una solicitud</h2><p className="mt-2 text-sm text-text-secondary-light">Aquí verá la aerolínea, el representante y los servicios solicitados.</p></div>}</section>
    </div>
  </div>;
}

function RequestReview({ request, stations, act, canVerify, canApprove, canReject }) {
  const [legal, setLegal] = useState({ legalName: request.legalName ?? '', countryCode: request.countryCode ?? '', iataCode: request.iataCode ?? '', icaoCode: request.icaoCode ?? '', verificationSourceUrl: request.verificationSourceUrl ?? '' });
  const [stationIds, setStationIds] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const final = ['Approved', 'Rejected', 'Cancelled'].includes(request.status);
  async function verify(event) {
    event.preventDefault(); setBusy(true);
    await act(() => verifyCommercialAirline(request.airlineProfileId, legal), 'Aerolínea verificada. Ahora puede aprobar la solicitud.');
    setBusy(false);
  }
  async function decide(approve) {
    setBusy(true);
    const saved = await act(() => decideCommercialRequest(request.id, { approve, reason: approve ? null : reason, stationIds: approve ? stationIds : [] }),
      approve ? 'Solicitud aprobada. Se creó un contrato en borrador y el superadministrador recibió la tarea de crear la cuenta.' : 'Solicitud rechazada.');
    if (saved) setReason('');
    setBusy(false);
  }
  return <div className="space-y-5"><div><p className="text-xs font-mono uppercase text-signal-500">{request.reference}</p><h2 className="mt-1 text-xl font-bold">{request.airline}</h2><p className="text-xs text-text-secondary-light">{request.airlineVerified ? 'Identidad verificada por Contratos' : 'Identidad legal pendiente de verificación'}</p></div>
    <div className="rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]"><strong>Representante legal</strong><dl className="mt-2 grid grid-cols-2 gap-2"><div><dt className="text-xs text-text-secondary-light">Nombre</dt><dd>{request.representativeName}</dd></div><div><dt className="text-xs text-text-secondary-light">Cargo</dt><dd>{request.representativeTitle}</dd></div><div><dt className="text-xs text-text-secondary-light">Correo</dt><dd className="break-all">{request.representativeEmail}</dd></div><div><dt className="text-xs text-text-secondary-light">Teléfono</dt><dd>{request.representativePhone}</dd></div></dl><p className="mt-2 text-xs">{request.authorityDeclared ? '✓ Declaró autorización para representar a la aerolínea.' : 'No declaró autorización.'}</p></div>
    <RepresentativeExtraDetails request={request} />
    <div><h3 className="text-sm font-bold">Servicios solicitados</h3><ul className="mt-2 space-y-1">{request.services.map((service, index) => <li key={`${service.serviceId}-${index}`} className="rounded bg-accent-600/[.06] px-3 py-2 text-sm">{service.name} <span className="text-xs text-text-secondary-light">· {service.unit}</span></li>)}</ul></div>
    {!final && canVerify && <form onSubmit={verify} className="border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-bold">Verificar identidad de la aerolínea</h3><p className="mt-1 text-xs text-text-secondary-light">Complete los datos con una fuente oficial. La lista histórica de clientes por sí sola no acredita razón social ni códigos. El logo se administra en Aerolíneas por Superadministrador.</p><div className="mt-3 grid grid-cols-2 gap-3">{[['legalName', 'Razón social', 200], ['countryCode', 'País (2 letras)', 2], ['iataCode', 'IATA (2 caracteres)', 2], ['icaoCode', 'ICAO (3 letras)', 3], ['verificationSourceUrl', 'Fuente HTTPS', 512]].map(([key, label, max]) => <label key={key} className={`text-xs font-semibold ${['verificationSourceUrl', 'legalName'].includes(key) ? 'col-span-2' : ''}`}>{label}<input required maxLength={max} value={legal[key]} onChange={event => setLegal(current => ({ ...current, [key]: ['countryCode', 'iataCode', 'icaoCode'].includes(key) ? event.target.value.toUpperCase() : event.target.value }))} className="mt-1 block w-full rounded-lg border border-black/10 bg-white p-2 text-sm dark:bg-surface-dark" /></label>)}</div><button disabled={busy} className="mt-3 rounded-lg border border-accent-600 px-4 py-2 text-xs font-semibold text-accent-600">Guardar verificación</button></form>}
    {!final && (canApprove || canReject) && <div className="border-t border-black/10 pt-4 dark:border-white/10"><h3 className="font-bold">Decisión contractual</h3><p className="mt-1 text-xs text-text-secondary-light">Al aprobar se crea un contrato y versión en borrador. La operación requiere activación posterior.</p>{canApprove && <fieldset className="mt-3"><legend className="text-xs font-semibold">Estaciones solicitadas para el borrador</legend>{stations.map(station => <label key={station.id} className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={stationIds.includes(station.id)} onChange={event => setStationIds(current => event.target.checked ? [...current, station.id] : current.filter(id => id !== station.id))} />{station.code} · {station.name}</label>)}</fieldset>}<div className="mt-4 flex flex-wrap gap-2">{canApprove && <button type="button" disabled={busy || !request.airlineVerified || !stationIds.length || !request.authorityDeclared} onClick={() => void decide(true)} className="rounded-lg bg-accent-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Aprobar y crear borrador</button>}</div>{canReject && <><label className="mt-4 block text-xs font-semibold">Motivo de rechazo<textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={1000} className="mt-1 block w-full rounded-lg border border-black/10 p-2 text-sm dark:bg-surface-dark" /></label><button type="button" disabled={busy || !reason.trim()} onClick={() => void decide(false)} className="mt-2 rounded-lg border border-status-danger px-4 py-2 text-xs font-semibold text-status-danger disabled:opacity-50">Rechazar solicitud</button></>}</div>}
    {final && <p className="rounded-lg bg-black/[.04] p-4 text-sm dark:bg-white/[.04]">Estado: {labels[request.status] ?? request.status}{request.decisionReason && ` · ${request.decisionReason}`}{request.contractId && ` · Borrador ${request.contractId.slice(0, 12)}`}</p>}
  </div>;
}

function RepresentativeExtraDetails({ request }) {
  const details = [
    ['Nacionalidad', request.representativeNationalityCode],
    ['Documento', request.representativeDocumentType && request.representativeDocumentNumber
      ? `${request.representativeDocumentType} · ${request.representativeDocumentNumber}` : null],
    ['Dirección', request.representativeAddress],
    ['País', request.representativeCountry],
    ['Provincia', request.representativeProvince],
    ['Municipio', request.representativeMunicipality],
  ].filter(([, value]) => value);
  if (!details.length) return null;
  return <div className="rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]"><strong>Información adicional del representante</strong><dl className="mt-2 grid grid-cols-2 gap-2">{details.map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary-light">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl></div>;
}
