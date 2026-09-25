"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  createElevantApiClient,
  ElevantApiError,
  type AirlinePortalBootstrapResponse,
  type SessionActorResponse,
} from "@elevant/api-client";
import styles from "./DevelopmentAirlinePortal.module.css";

type PortalView =
  | { kind: "signed-out" }
  | { kind: "ready"; actor: SessionActorResponse; bootstrap: AirlinePortalBootstrapResponse };

const operationStatusLabels: Record<string, string> = {
  Planned: "Planificada",
  Assigned: "Asignada",
  InProgress: "En ejecución",
  PendingReview: "Entregada a OCC",
  InReview: "En revisión",
  Approved: "Aprobada",
  Returned: "Devuelta para corrección",
  Cancelled: "Cancelada",
};

function safeMessage(error: unknown): string {
  if (error instanceof ElevantApiError) {
    if (error.status === 401) return "No se pudo validar la cuenta. Revisa el correo y la contraseña.";
    if (error.status === 403) return "Esta cuenta no tiene acceso al portal de aerolíneas.";
    if (error.status === 404) return "La API conectada todavía no publica el contexto de esta aerolínea.";
  }
  return "No se pudo contactar la API. Comprueba Tailscale y vuelve a intentar.";
}

export function DevelopmentAirlinePortal({ baseUrl }: { baseUrl: string }) {
  const token = useRef<string | null>(null);
  const [view, setView] = useState<PortalView>({ kind: "signed-out" });
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const signOut = () => {
    token.current = null;
    setView({ kind: "signed-out" });
    setFeedback(null);
  };

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFeedback(null);
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    try {
      const unauthenticated = createElevantApiClient({ baseUrl });
      const session = await unauthenticated.createSession({ email, password });
      const authenticated = createElevantApiClient({
        baseUrl,
        getAccessToken: () => session.accessToken,
      });
      const bootstrap = await authenticated.getAirlinePortalBootstrap({ cache: "no-store" });
      token.current = session.accessToken;
      form.reset();
      setView({ kind: "ready", actor: session.actor, bootstrap });
    } catch (error) {
      token.current = null;
      setView({ kind: "signed-out" });
      setFeedback(safeMessage(error));
    } finally {
      setPending(false);
    }
  };

  const refresh = async () => {
    if (!token.current || pending) return;
    const activeToken = token.current;
    setPending(true);
    setFeedback(null);
    try {
      const client = createElevantApiClient({
        baseUrl,
        getAccessToken: () => activeToken,
      });
      const [session, bootstrap] = await Promise.all([
        client.getCurrentSession({ cache: "no-store" }),
        client.getAirlinePortalBootstrap({ cache: "no-store" }),
      ]);
      if (token.current === activeToken) {
        setView({ kind: "ready", actor: session.actor, bootstrap });
      }
    } catch (error) {
      if (token.current !== activeToken) return;
      if (error instanceof ElevantApiError && [401, 403].includes(error.status)) {
        token.current = null;
        setView({ kind: "signed-out" });
      }
      setFeedback(safeMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Volver a ELEVANT">
          <span className={styles.brandMark} aria-hidden="true" /> ELEVANT
        </Link>
        <span className={styles.environment}>Desarrollo · API configurada</span>
      </header>
      <div className={styles.content}>
        <div className={styles.intro}>
          <span className={styles.kicker}>Portal de aerolíneas</span>
          <h1>Tu operación, desde una sola fuente.</h1>
          <p>Consulta únicamente la aerolínea y las estaciones que la API autoriza para tu cuenta.</p>
          <div className={styles.route} aria-hidden="true"><span /><i /><span /></div>
        </div>

        {view.kind === "signed-out" ? (
          <section className={styles.card} aria-labelledby="access-title">
            <span className={styles.cardLabel}>Acceso real · Development</span>
            <h2 id="access-title">Inicia sesión con tu cuenta de aerolínea</h2>
            <form onSubmit={signIn} className={styles.form}>
              <label htmlFor="live-email">Correo corporativo</label>
              <input id="live-email" name="email" type="email" autoComplete="username" required maxLength={256} />
              <label htmlFor="live-password">Contraseña</label>
              <input id="live-password" name="password" type="password" autoComplete="current-password" required />
              {feedback && <p className={styles.error} role="alert">{feedback}</p>}
              <button type="submit" disabled={pending}>{pending ? "Validando…" : "Entrar al portal"}</button>
            </form>
            <p className={styles.note}>La sesión permanece solo en memoria. Recargar o cerrar esta página solicita iniciar sesión de nuevo.</p>
          </section>
        ) : (
          <section className={styles.card} aria-labelledby="airline-title">
            <div className={styles.cardTop}>
              <span className={styles.cardLabel}>Contexto validado por la API</span>
              <button type="button" className={styles.textButton} onClick={signOut}>Cerrar sesión</button>
            </div>
            <div className={styles.airlineBand}>
              <span className={styles.airlineCode}>{view.bootstrap.iataCode}</span>
              <div><h2 id="airline-title">{view.bootstrap.name}</h2><p>{view.actor.email}</p></div>
            </div>
            <div className={styles.stationHeader}>
              <h3>Estaciones contratadas</h3>
              <button type="button" className={styles.textButton} onClick={refresh} disabled={pending}>
                {pending ? "Actualizando…" : "Actualizar desde la API"}
              </button>
            </div>
            {view.bootstrap.stations.length === 0 ? (
              <p className={styles.empty}>No hay estaciones cubiertas por un contrato vigente. Consulta a Contratos antes de planificar una operación.</p>
            ) : (
              <ul className={styles.stations}>
                {view.bootstrap.stations.map((station) => <li key={station.id}>
                  <strong>{station.code}</strong><span>{station.name}</span>
                  <small>{station.ianaTimeZone}</small>
                </li>)}
              </ul>
            )}
            <div className={styles.operationsHeader}>
              <h3>Operaciones actuales</h3>
              <span>Hoy y próximos 7 días · UTC</span>
            </div>
            {view.bootstrap.currentOperations.length === 0 ? (
              <p className={styles.empty}>No hay operaciones en esta ventana para tus estaciones contratadas.</p>
            ) : (
              <ul className={styles.operations} aria-label="Operaciones actuales de la aerolínea">
                {view.bootstrap.currentOperations.map((operation) => (
                  <li key={operation.id}>
                    <div className={styles.operationTop}>
                      <strong>{operation.code}</strong>
                      <span>{operationStatusLabels[operation.status] ?? operation.status}</span>
                    </div>
                    <p>{operation.stationCode} · {operation.operationDate}</p>
                    <small>
                      Llegada {operation.arrivalFlightNumber ?? "sin vuelo"} · Salida {operation.departureFlightNumber ?? "sin vuelo"}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            {feedback && <p className={styles.error} role="alert">{feedback}</p>}
            <p className={styles.note}>Esta vista muestra solo operaciones de la ventana actual. El histórico, las solicitudes y las facturas siguen fuera de este recorrido real.</p>
          </section>
        )}
      </div>
    </main>
  );
}
