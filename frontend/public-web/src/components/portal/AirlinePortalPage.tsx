"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ElevantApiError, type AirlineOperationPageResponse,
  type AirlineOperationalRequestPageResponse, type AirlinePortalBootstrapResponse,
  type AirlinePortalOperationResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { AirlineContractPage } from "./AirlineContractPage";
import { AirlineFinancePage } from "./AirlineFinancePage";
import { AirlineDocumentsPage } from "./AirlineDocumentsPage";
import styles from "./AirlinePortalPage.module.css";

type View = "overview" | "flights" | "flightDetail" | "requests" | "contracts"
  | "documents" | "finance" | "reports" | "profile";

const MODULES: Record<Exclude<View, "overview" | "flights" | "flightDetail" | "profile" | "contracts" | "requests" | "finance" | "documents">,
  { title: string; description: string }> = {
  reports: { title: "Reportes", description: "Los reportes todavía no están disponibles mediante la API del portal." },
};

const PREVIEW: Record<keyof typeof MODULES, { metrics: [string, string][]; rows: [string, string, string][] }> = {
  reports: {
    metrics: [["Vuelos de ejemplo", "4"], ["Puntualidad", "50%"], ["Servicio", "67%"], ["Facturación", "US$413" ]],
    rows: [["Operaciones completadas", "50%", "Indicador ilustrativo"],
      ["Ejecución de servicios", "67%", "Indicador ilustrativo"]],
  },
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  Submitted: "Recibida", InReview: "En revisión", Accepted: "Aceptada",
  Rejected: "Rechazada", Completed: "Completada", Cancelled: "Cancelada",
};

function Operation({ operation }: { operation: AirlinePortalBootstrapResponse["currentOperations"][number] }) {
  return <li className={styles.operation}>
    <div>
      <span className={styles.kicker}>{operation.stationCode} · {operation.operationDate}</span>
      <strong>{operation.code}</strong>
      <p>{[operation.arrivalFlightNumber, operation.departureFlightNumber].filter(Boolean).join(" → ") || "Vuelo no informado"}</p>
    </div>
    <div className={styles.operationSide}>
      <span>{operation.status}</span>
      <Link href={`/portal/vuelos/${encodeURIComponent(operation.id)}`}>Ver {operation.code}</Link>
    </div>
  </li>;
}

function AirlineFlightsPage({ airlineName }: {
  airlineName: string;
}) {
  const { getOperations, operationRevision } = useAirlineSession();
  const [flightQuery, setFlightQuery] = useState("");
  const [pages, setPages] = useState<AirlineOperationPageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    void getOperations(1).then(page => {
      if (request === generation.current) { setPages([page]); setError(false); }
    }).catch(() => { if (request === generation.current) setError(true); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [getOperations, operationRevision, retryKey]);

  const loadMore = useCallback(async () => {
    if (loading || !pages.at(-1)?.hasMore) return;
    const request = generation.current;
    setLoading(true);
    try {
      const next = await getOperations(pages.length + 1);
      if (request === generation.current) {
        setPages(previous => [...previous, next]);
        setError(false);
      }
    } catch { if (request === generation.current) setError(true); }
    finally { if (request === generation.current) setLoading(false); }
  }, [getOperations, loading, pages]);

  const operations = pages.flatMap(page => page.operations);
  const query = flightQuery.trim().toLocaleLowerCase("es");
  const visibleOperations = query ? operations.filter(operation =>
    [operation.code, operation.stationCode, operation.arrivalFlightNumber,
      operation.departureFlightNumber].some(value =>
      value?.toLocaleLowerCase("es").includes(query))) : operations;

  return <div className={styles.page}>
    <div className={styles.realScope}><div><span className={styles.kicker}>Vuelos · {airlineName}</span>
      <p>{operations.length} operaciones cargadas del historial autorizado.</p></div></div>
    <label className={styles.flightSearch}>Buscar vuelo u operación
      <input type="search" value={flightQuery} onChange={event => setFlightQuery(event.target.value)}
        placeholder="Número de vuelo, operación o estación" />
    </label>
    <section className={styles.panel} aria-label="Operaciones reales de la aerolínea">
      <div className={styles.sectionHeading}><h2>Operaciones reales de {airlineName}</h2><span className={styles.previewPill}>Historial · API</span></div>
      {loading && pages.length === 0 && <p role="status">Cargando vuelos autorizados…</p>}
      {error && <div role="alert"><p>No se pudo actualizar el historial de vuelos.</p>
        {pages.length === 0 && <button type="button" onClick={() => {
          setLoading(true); setError(false); setRetryKey(current => current + 1);
        }}>Reintentar</button>}</div>}
      {visibleOperations.length > 0 && <ul className={styles.operations}>{visibleOperations.map(operation =>
        <Operation key={operation.id} operation={operation} />)}</ul>}
      {!loading && !error && visibleOperations.length === 0 && <p className={styles.empty}>{operations.length
        ? "No hay vuelos que coincidan con la búsqueda."
        : "No hay vuelos registrados para esta aerolínea."}</p>}
    </section>
    {pages.at(-1)?.hasMore && <button className={styles.loadMore} type="button" disabled={loading}
      onClick={() => void loadMore()}>{loading ? "Cargando…" : "Cargar más vuelos"}</button>}
  </div>;
}

function AirlineFlightDetail({ operationId }: { operationId: string }) {
  const { getOperation, operationRevision } = useAirlineSession();
  const [operation, setOperation] = useState<AirlinePortalOperationResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    void getOperation(operationId).then(result => {
      if (request === generation.current) { setOperation(result); setStatus("ready"); }
    }).catch(error => {
      if (request !== generation.current) return;
      if (error instanceof ElevantApiError && error.status === 404) {
        setOperation(null);
        setStatus("missing");
      } else setStatus("error");
    });
    return () => { generation.current += 1; };
  }, [getOperation, operationId, operationRevision, retryKey]);

  return <div className={styles.page}>
    <header className={styles.pageHeader}><span className={styles.kicker}>Detalle autorizado</span><h1>Detalle de vuelo</h1></header>
    {status === "loading" && <p role="status">Cargando operación autorizada…</p>}
    {status === "missing" && <section className={styles.panel}><p>Esta operación no está disponible en la consulta autorizada.</p></section>}
    {status === "error" && <div role="alert"><p>No se pudo actualizar el detalle del vuelo.</p>
      <button type="button" onClick={() => { setStatus("loading"); setRetryKey(current => current + 1); }}>Reintentar</button></div>}
    {status === "ready" && operation && <section className={styles.panel}>
      <h2>{operation.code}</h2>
      <dl className={styles.details}>
        <div><dt>Estación</dt><dd>{operation.stationCode}</dd></div>
        <div><dt>Fecha operativa</dt><dd>{operation.operationDate}</dd></div>
        <div><dt>Estado</dt><dd>{operation.status}</dd></div>
        {operation.arrivalFlightNumber && <div><dt>Vuelo de llegada</dt><dd>{operation.arrivalFlightNumber}</dd></div>}
        {operation.departureFlightNumber && <div><dt>Vuelo de salida</dt><dd>{operation.departureFlightNumber}</dd></div>}
      </dl>
      <p className={styles.note}>Los servicios, evidencias y tiempos reales aún no están disponibles en esta consulta.</p>
    </section>}
    <Link href="/portal/vuelos">Volver a vuelos</Link>
  </div>;
}

function AirlineRequestsPage({ airlineName }: { airlineName: string }) {
  const { getRequests, operationRevision } = useAirlineSession();
  const [pages, setPages] = useState<AirlineOperationalRequestPageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    void getRequests(1).then(page => {
      if (request === generation.current) { setPages([page]); setError(false); }
    }).catch(() => { if (request === generation.current) setError(true); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [getRequests, operationRevision, retryKey]);

  const loadMore = useCallback(async () => {
    if (loading || !pages.at(-1)?.hasMore) return;
    const request = generation.current;
    setLoading(true);
    try {
      const next = await getRequests(pages.length + 1);
      if (request === generation.current) {
        setPages(previous => [...previous, next]);
        setError(false);
      }
    } catch { if (request === generation.current) setError(true); }
    finally { if (request === generation.current) setLoading(false); }
  }, [getRequests, loading, pages]);

  const requests = pages.flatMap(page => page.requests);
  const count = (...statuses: string[]) => requests.filter(request =>
    statuses.includes(request.status ?? "")).length;

  return <div className={styles.page}>
    <header className={styles.requestHeading}>
      <div><span className={styles.kicker}>Canal de servicio · {airlineName}</span>
        <h1>Solicitudes con estado visible.</h1>
        <p>Consulta las solicitudes operativas registradas para tu aerolínea. La creación y cancelación todavía no están habilitadas.</p></div>
      <button type="button" disabled title="La creación de solicitudes aún no está disponible">Nueva solicitud</button>
    </header>
    <div className={styles.metrics} aria-label="Estado de las solicitudes cargadas">
      <div><span>Solicitudes cargadas</span><strong>{requests.length}</strong></div>
      <div><span>En seguimiento</span><strong>{count("Submitted", "InReview")}</strong></div>
      <div><span>Aceptadas</span><strong>{count("Accepted")}</strong></div>
      <div><span>Completadas</span><strong>{count("Completed")}</strong></div>
    </div>
    {loading && pages.length === 0 && <p role="status">Cargando solicitudes autorizadas…</p>}
    {error && <div role="alert"><p>No se pudo actualizar el historial de solicitudes.</p>
      {pages.length === 0 && <button type="button" onClick={() => {
        setLoading(true); setError(false); setRetryKey(current => current + 1);
      }}>Reintentar</button>}</div>}
    {requests.map(request => <section key={request.id} className={styles.panel}
      aria-label={`Solicitud ${request.serviceName}`}>
      <span className={styles.kicker}>{request.stationCode} · {request.requestedAt.slice(0, 10)}</span>
      <div className={styles.requestCardHeading}><h2>{request.serviceName}</h2><span>{REQUEST_STATUS_LABELS[request.status ?? ""] ?? request.status}</span></div>
      <p className={styles.note}>{request.description}</p>
      <dl className={styles.details}>
        {request.operationCode && <div><dt>Operación asociada</dt><dd>{request.operationId
          ? <Link href={`/portal/vuelos/${encodeURIComponent(request.operationId)}`}>{request.operationCode}</Link>
          : request.operationCode}</dd></div>}
        <div><dt>Estación</dt><dd>{request.stationCode}</dd></div>
        <div><dt>Estado</dt><dd>{REQUEST_STATUS_LABELS[request.status ?? ""] ?? request.status}</dd></div>
      </dl>
      <button className={styles.disabledAction} type="button" disabled>Cancelar solicitud</button>
    </section>)}
    {!loading && !error && requests.length === 0 && <p className={styles.empty}>No hay solicitudes operativas registradas para esta aerolínea.</p>}
    {pages.at(-1)?.hasMore && <button className={styles.loadMore} type="button" disabled={loading}
      onClick={() => void loadMore()}>{loading ? "Cargando…" : "Cargar más solicitudes"}</button>}
  </div>;
}

export function AirlinePortalPage({ view, operationId }: { view: View; operationId?: string }) {
  const { session } = useAirlineSession();
  if (!session) return null;
  const { actor, bootstrap } = session;
  const { currentOperations: operations, stations } = bootstrap;
  const countStatus = (...statuses: string[]) => operations.filter((operation) =>
    statuses.includes(operation.status.replace(/[^a-z]/gi, "").toLowerCase())).length;

  if (view === "overview") return <div className={styles.page}>
    <header className={styles.hero}>
      <span className={styles.kicker}>Operación autorizada</span><h1>{bootstrap.name}</h1>
      <p>{operations.length} operaciones reales en la ventana actual · {stations.length} estación(es) autorizada(s) · {bootstrap.iataCode || bootstrap.icaoCode}</p>
    </header>
    <div className={styles.metrics} aria-label="Estado de las operaciones visibles">
      <div><span>Operaciones visibles</span><strong>{operations.length}</strong></div>
      <div><span>En curso</span><strong>{countStatus("inprogress")}</strong></div>
      <div><span>En revisión</span><strong>{countStatus("pendingreview", "inreview")}</strong></div>
      <div><span>Aprobadas</span><strong>{countStatus("approved")}</strong></div>
    </div>
    <section className={styles.panel} aria-labelledby="current-operations-heading">
      <div className={styles.sectionHeading}><h2 id="current-operations-heading">Operaciones actuales</h2><Link href="/portal/vuelos">Ver vuelos</Link></div>
      {operations.length ? <ul className={styles.operations}>{operations.slice(0, 5).map((operation) => <Operation key={operation.id} operation={operation} />)}</ul>
        : <p className={styles.empty}>No hay operaciones en la ventana actual para esta aerolínea.</p>}
    </section>
  </div>;

  if (view === "flights") return <AirlineFlightsPage key={actor.accountId}
    airlineName={bootstrap.name} />;

  if (view === "contracts") return <AirlineContractPage
    key={`${actor.accountId}:${bootstrap.organizationId}`} />;

  if (view === "flightDetail") return <AirlineFlightDetail
    key={`${actor.accountId}:${operationId}`} operationId={operationId ?? ""} />;

  if (view === "profile") return <div className={styles.page}>
    <header className={styles.pageHeader}><span className={styles.kicker}>Identidad verificada</span><h1>Perfil</h1><p>Alcance de la sesión confirmado por la API.</p></header>
    <section className={styles.profileHero} aria-label="Aerolínea autorizada">
      <span className={styles.kicker}>Cuenta autorizada · lectura real</span>
      <h2>{bootstrap.name}</h2>
      <p>{actor.displayName} · {bootstrap.iataCode || bootstrap.icaoCode}</p>
      <div>{stations.map((station) => <span key={station.id}>{station.code}</span>)}</div>
    </section>
    <section className={styles.panel}>
      <dl className={styles.details}>
        <div><dt>Nombre</dt><dd>{actor.displayName}</dd></div>
        <div><dt>Correo</dt><dd>{actor.email}</dd></div>
        <div><dt>Aerolínea</dt><dd>{bootstrap.name}</dd></div>
      </dl>
      <h2>Estaciones autorizadas</h2>
      {stations.length ? <ul className={styles.stations}>{stations.map((station) => <li key={station.id}>{station.code} · {station.name}</li>)}</ul>
        : <p className={styles.empty}>No hay estaciones autorizadas.</p>}
    </section>
  </div>;

  if (view === "requests") return <AirlineRequestsPage
    key={actor.accountId} airlineName={bootstrap.name} />;

  if (view === "finance") return <AirlineFinancePage
    key={actor.accountId} airlineName={bootstrap.name} />;

  if (view === "documents") return <AirlineDocumentsPage key={actor.accountId} />;

  const previewModule = MODULES[view];
  const preview = PREVIEW[view];
  return <div className={styles.page}>
    <header className={styles.pageHeader}><span className={styles.kicker}>Portal de aerolíneas</span><h1>{previewModule.title}</h1>
      <p>{previewModule.description}</p></header>
    <section className={styles.demoBanner} role="status">
      <strong>Datos de demostración · solo vista previa</strong>
      <p>Los siguientes importes, registros e indicadores son sintéticos. No pertenecen a {bootstrap.name}; las acciones están deshabilitadas.</p>
    </section>
    <div className={styles.metrics}>{preview.metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <section className={styles.panel} aria-label={`Vista previa de ${previewModule.title.toLowerCase()}`}>
      <div className={styles.sectionHeading}><h2>Indicadores de ejemplo</h2>
        <span className={styles.previewPill}>Sin conexión a datos reales</span></div>
      <ul className={styles.previewRows}>{preview.rows.map(([code, title, description]) => <li key={code}>
        <span className={styles.kicker}>{code}</span><strong>{title}</strong><p>{description}</p>
        {view === "reports" && <div className={styles.previewBar}><span style={{ width: title === "50%" ? "50%" : "67%" }} /></div>}
      </li>)}</ul>
    </section>
  </div>;
}
