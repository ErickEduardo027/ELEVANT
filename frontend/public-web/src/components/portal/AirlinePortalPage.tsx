"use client";

import Link from "next/link";
import type { AirlinePortalBootstrapResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { PortalDemoPreview } from "./PortalDemoPreview";
import { AirlineContractPage } from "./AirlineContractPage";
import styles from "./AirlinePortalPage.module.css";

type View = "overview" | "flights" | "flightDetail" | "requests" | "contracts"
  | "documents" | "finance" | "reports" | "profile";

const MODULES: Record<Exclude<View, "overview" | "flights" | "flightDetail" | "profile" | "contracts">,
  { title: string; description: string }> = {
  requests: { title: "Solicitudes", description: "El historial y las acciones de solicitudes todavía no están disponibles mediante la API del portal." },
  documents: { title: "Documentos", description: "Los documentos todavía no están disponibles mediante la API del portal." },
  finance: { title: "Finanzas", description: "La información financiera todavía no está disponible mediante la API del portal." },
  reports: { title: "Reportes", description: "Los reportes todavía no están disponibles mediante la API del portal." },
};

const PREVIEW: Record<keyof typeof MODULES, { metrics: [string, string][]; rows: [string, string, string][] }> = {
  requests: {
    metrics: [["Total de ejemplo", "1"], ["En seguimiento", "1"], ["Aprobadas", "0"], ["Cancelables", "0"]],
    rows: [["DEMO-SOL-001", "Escalera adicional", "Ejemplo de solicitud recibida · sin registro real"]],
  },
  documents: {
    metrics: [["Documentos de ejemplo", "3"], ["Disponibles", "2"], ["En procesamiento", "1"], ["Descargas", "0"]],
    rows: [["DEMO-DOC-001", "Reporte operativo de ejemplo", "PDF · no descargable"],
      ["DEMO-DOC-002", "Orden de servicio de ejemplo", "PDF · no descargable"],
      ["DEMO-DOC-003", "Evidencia en procesamiento", "Vista de ejemplo"]],
  },
  finance: {
    metrics: [["Saldo de ejemplo", "US$1,770"], ["Prefacturas", "1"], ["Conciliaciones", "2"], ["Casos", "0"]],
    rows: [["DEMO-PRE-001", "Prefactura de ejemplo", "Importe y estado sintéticos · sin efecto contable"]],
  },
  reports: {
    metrics: [["Vuelos de ejemplo", "4"], ["Puntualidad", "50%"], ["Servicio", "67%"], ["Facturación", "US$413" ]],
    rows: [["Operaciones completadas", "50%", "Indicador ilustrativo"],
      ["Ejecución de servicios", "67%", "Indicador ilustrativo"]],
  },
};

function Operation({ operation, compact = false }: { operation: AirlinePortalBootstrapResponse["currentOperations"][number]; compact?: boolean }) {
  return <li className={styles.operation}>
    <div>
      <span className={styles.kicker}>{operation.stationCode} · {operation.operationDate}</span>
      <strong>{operation.code}</strong>
      <p>{[operation.arrivalFlightNumber, operation.departureFlightNumber].filter(Boolean).join(" → ") || "Vuelo no informado"}</p>
    </div>
    <div className={styles.operationSide}>
      <span>{operation.status}</span>
      {!compact && <Link href={`/portal/vuelos/${encodeURIComponent(operation.id)}`}>Ver {operation.code}</Link>}
    </div>
  </li>;
}

export function AirlinePortalPage({ view, operationId }: { view: View; operationId?: string }) {
  const { session } = useAirlineSession();
  if (!session) return null;
  const { actor, bootstrap } = session;
  const { currentOperations: operations, stations } = bootstrap;

  if (view === "overview") return <div className={styles.page}>
    <header className={styles.realScope}>
      <div><span className={styles.kicker}>Consulta real · API de Development</span><h1>{bootstrap.name}</h1></div>
      <p>{operations.length} operaciones reales en la ventana actual · {stations.length} estación(es) autorizada(s) · {bootstrap.iataCode || bootstrap.icaoCode}</p>
    </header>
    <section className={styles.demoBanner} role="status"><strong>Datos sintéticos · muestra visual</strong>
      <p>La siguiente secuencia ilustra el diseño del portal. Los vuelos y eventos EV no pertenecen a {bootstrap.name} ni provienen del VPS; no se pueden abrir ni modificar.</p></section>
    <PortalDemoPreview view="overview" />
    <section className={styles.panel} aria-labelledby="current-operations-heading">
      <div className={styles.sectionHeading}><h2 id="current-operations-heading">Operaciones actuales</h2><Link href="/portal/vuelos">Ver vuelos</Link></div>
      {operations.length ? <ul className={styles.operations}>{operations.slice(0, 5).map((operation) => <Operation key={operation.id} operation={operation} />)}</ul>
        : <p className={styles.empty}>No hay operaciones en la ventana actual para esta aerolínea.</p>}
    </section>
  </div>;

  if (view === "flights") return <div className={styles.page}>
    <div className={styles.realScope}><div><span className={styles.kicker}>Consulta real · {bootstrap.name}</span>
      <p>{operations.length} operaciones reales en la ventana actual, según la API.</p></div></div>
    <section className={styles.demoBanner} role="status"><strong>Datos sintéticos · muestra visual</strong>
      <p>Las rotaciones EV de la tabla son ejemplos separados de la consulta real de {bootstrap.name}. Puedes probar los filtros, pero sus detalles no son navegables.</p></section>
    <PortalDemoPreview view="flights" />
    <section className={styles.panel} aria-label="Operaciones reales de la aerolínea">
      <div className={styles.sectionHeading}><h2>Operaciones reales de {bootstrap.name}</h2><span className={styles.previewPill}>API · ventana actual</span></div>
      {operations.length ? <ul className={styles.operations}>{operations.map((operation) => <Operation key={operation.id} operation={operation} />)}</ul>
        : <p className={styles.empty}>No hay vuelos disponibles en la ventana actual.</p>}
    </section>
  </div>;

  if (view === "contracts") return <AirlineContractPage
    key={`${actor.accountId}:${bootstrap.organizationId}`} />;

  if (view === "flightDetail") {
    const operation = operations.find((item) => item.id === operationId);
    return <div className={styles.page}>
      <header className={styles.pageHeader}><span className={styles.kicker}>Detalle autorizado</span><h1>Detalle de vuelo</h1></header>
      {operation ? <section className={styles.panel}>
        <h2>{operation.code}</h2>
        <dl className={styles.details}>
          <div><dt>Estación</dt><dd>{operation.stationCode}</dd></div>
          <div><dt>Fecha operativa</dt><dd>{operation.operationDate}</dd></div>
          <div><dt>Estado</dt><dd>{operation.status}</dd></div>
          {operation.arrivalFlightNumber && <div><dt>Vuelo de llegada</dt><dd>{operation.arrivalFlightNumber}</dd></div>}
          {operation.departureFlightNumber && <div><dt>Vuelo de salida</dt><dd>{operation.departureFlightNumber}</dd></div>}
        </dl>
        <p className={styles.note}>Los servicios, evidencias y tiempos reales aún no están disponibles en esta consulta.</p>
      </section> : <section className={styles.panel}><p>Esta operación no está disponible en la consulta autorizada.</p></section>}
      <Link href="/portal/vuelos">Volver a vuelos</Link>
    </div>;
  }

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

  if (view === "requests") return <div className={styles.page}>
    <header className={styles.requestHeading}>
      <div><span className={styles.kicker}>Canal de servicio · vista previa</span>
        <h1>Solicitudes con estado visible.</h1>
        <p>Consulta cómo se presentarán las solicitudes autorizadas. El historial real y las acciones todavía no están disponibles mediante la API.</p></div>
      <button type="button" disabled title="La creación de solicitudes aún no está disponible">Nueva solicitud</button>
    </header>
    <section className={styles.demoBanner} role="status"><strong>Datos sintéticos · solo vista previa</strong>
      <p>La solicitud y los indicadores siguientes no pertenecen a {bootstrap.name}. No se puede crear, cancelar ni modificar nada desde esta pantalla.</p></section>
    <div className={styles.metrics}>
      <div><span>Total de ejemplo</span><strong>1</strong></div><div><span>En seguimiento</span><strong>1</strong></div>
      <div><span>Aprobadas</span><strong>0</strong></div><div><span>Cancelables</span><strong>0</strong></div>
    </div>
    <section className={styles.panel} aria-label="Solicitud de ejemplo">
      <span className={styles.kicker}>Servicio adicional · DEMO-SOL-001</span>
      <div className={styles.requestCardHeading}><h2>Escalera adicional</h2><span>Recibida · ejemplo</span></div>
      <p className={styles.note}>Escalera adicional para desembarque posterior.</p>
      <dl className={styles.details}><div><dt>Vuelo asociado</dt><dd>EV 418 · BOG → PUJ</dd></div>
        <div><dt>Estación</dt><dd>PUJ</dd></div><div><dt>Estado</dt><dd>Recibida</dd></div></dl>
      <button className={styles.disabledAction} type="button" disabled>Cancelar solicitud</button>
    </section>
  </div>;

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
      <div className={styles.sectionHeading}><h2>{view === "documents" ? "Archivos de ejemplo" : view === "finance" ? "Prefacturas de ejemplo" : view === "reports" ? "Indicadores de ejemplo" : `Registros de ejemplo`}</h2>
        <span className={styles.previewPill}>Sin conexión a datos reales</span></div>
      <ul className={styles.previewRows}>{preview.rows.map(([code, title, description]) => <li key={code}>
        <span className={styles.kicker}>{code}</span><strong>{title}</strong><p>{description}</p>
        {view === "reports" && <div className={styles.previewBar}><span style={{ width: title === "50%" ? "50%" : "67%" }} /></div>}
        {view === "documents" && <button type="button" disabled>Descargar documento</button>}
        {view === "finance" && <div className={styles.actions}><button type="button" disabled>Aceptar prefactura</button><button type="button" disabled>Disputar prefactura</button></div>}
      </li>)}</ul>
    </section>
  </div>;
}
