"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { useMockSession } from "@/components/auth/MockSessionProvider";
import type { ServiceRequest } from "@/lib/portal";
import {
  cancelTrackedServiceRequest,
  createTrackedServiceRequest,
  listTrackedServiceRequests,
  type TrackedServiceRequest,
} from "@/lib/prototype-requests";

import { ClipboardIcon, PlaneIcon, SearchIcon } from "./PortalIcons";
import {
  EmptyState,
  Feedback,
  Field,
  Panel,
  PortalModal,
  PortalPageHeader,
  Provenance,
  StatusBadge,
  formatDateTime,
  portalModuleStyles as styles,
} from "./PortalModuleUI";
import { usePortalWorkspace } from "./PortalWorkspace";

const REQUEST_TYPE_LABELS: Record<ServiceRequest["type"], string> = {
  ADDITIONAL_SERVICE: "Servicio adicional",
  SCHEDULE_CHANGE: "Cambio de horario",
  SPECIAL_ASSISTANCE: "Asistencia especial",
  OTHER: "Otra solicitud",
};

type RequestDialog = { kind: "create" } | { kind: "cancel"; id: string };

function futureLocalDateTime(): string {
  const date = new Date(Date.now() + 24 * 60 * 60_000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function PortalRequests() {
  const { session } = useMockSession();
  const { data, timeMode } = usePortalWorkspace();
  const [requests, setRequests] = useState<TrackedServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState<RequestDialog | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const visibleRequests = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return requests.filter((request) => {
      const flight = data.flights.find((item) => item.id === request.flightId);
      const matchesQuery = !normalized || [
        request.id,
        request.title,
        request.description,
        flight?.flightNumber,
      ].join(" ").toLocaleLowerCase("es").includes(normalized);
      return matchesQuery && (!status || request.status === status);
    });
  }, [data.flights, query, requests, status]);

  const counts = useMemo(() => ({
    total: requests.length,
    review: requests.filter((request) => ["SUBMITTED", "IN_REVIEW"].includes(request.status)).length,
    approved: requests.filter((request) => request.status === "APPROVED").length,
    cancellable: requests.filter((request) => request.status === "SUBMITTED").length,
  }), [requests]);

  const loadRequests = useCallback(async (silent = false) => {
    if (!session) return;
    if (!silent) setLoading(true);
    try {
      setRequests(await listTrackedServiceRequests(session));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No fue posible consultar las solicitudes.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadRequests(), 0);
    const timer = window.setInterval(() => void loadRequests(true), 5_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [loadRequests]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog || !session) return;
    const form = new FormData(event.currentTarget);
    try {
      if (dialog.kind === "create") {
        const flightId = String(form.get("flightId") ?? "") || null;
        const created = await createTrackedServiceRequest(session, {
          station: String(form.get("station") ?? ""),
          flightId,
          type: String(form.get("type")) as ServiceRequest["type"],
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          requestedFor: String(form.get("requestedFor") ?? ""),
        });
        setRequests((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        setFeedback({ tone: "success", message: "Solicitud recibida por Contratos. Su estado se actualizará automáticamente." });
      } else {
        const updated = await cancelTrackedServiceRequest(session, dialog.id, String(form.get("reason") ?? ""));
        setRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
        setFeedback({ tone: "success", message: "Solicitud cancelada correctamente." });
      }
      setDialog(null);
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "No fue posible completar la solicitud." });
    }
  };

  return (
    <div className={styles.page}>
      <PortalPageHeader
        eyebrow="Canal de servicio"
        title="Solicitudes con estado visible."
        description="Solicita servicios o cambios para una rotación autorizada y consulta su avance. Esta versión no modifica la operación directamente."
        actions={
          <button className={styles.primaryButton} type="button" onClick={() => setDialog({ kind: "create" })}>
            <ClipboardIcon /> Nueva solicitud
          </button>
        }
      />

      {feedback && <Feedback tone={feedback.tone}>{feedback.message}</Feedback>}
      {loadError && <Feedback tone="error">{loadError}</Feedback>}

      <section className={styles.metricGrid} aria-label="Resumen de solicitudes">
        <article className={styles.metricCard}><span>Total</span><strong>{counts.total}</strong><small>Dentro del alcance autorizado</small></article>
        <article className={styles.metricCard}><span>En seguimiento</span><strong>{counts.review}</strong><small>Recibidas o en revisión</small></article>
        <article className={styles.metricCard}><span>Aprobadas</span><strong>{counts.approved}</strong><small>Confirmadas por AVIAM</small></article>
        <article className={styles.metricCard}><span>Cancelables</span><strong>{counts.cancellable}</strong><small>Solo mientras estén recibidas</small></article>
      </section>

      <div className={styles.toolbar}>
        <div className={styles.searchControl}>
          <SearchIcon />
          <label className={styles.visuallyHidden} htmlFor="request-search">Buscar solicitudes</label>
          <input
            id="request-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por título, vuelo o referencia"
          />
        </div>
        <div className={styles.selectControl}>
          <label className={styles.visuallyHidden} htmlFor="request-status">Filtrar por estado</label>
          <select id="request-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos los estados</option>
            <option value="SUBMITTED">Recibida</option>
            <option value="IN_REVIEW">En revisión</option>
            <option value="APPROVED">Aprobada</option>
            <option value="REJECTED">Rechazada</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
        </div>
      </div>

      <div className={styles.stack}>
        {visibleRequests.length ? visibleRequests.map((request) => {
          const flight = data.flights.find((item) => item.id === request.flightId);
          return (
            <article className={styles.dataCard} key={request.id}>
              <div className={styles.dataCardHeader}>
                <div>
                  <p className={styles.eyebrow}>{REQUEST_TYPE_LABELS[request.type]}</p>
                  <h2>{request.title}</h2>
                  <p>{request.id} · {request.station}</p>
                </div>
                <StatusBadge status={request.status} />
              </div>
              <p className={styles.pageDescription}>{request.description}</p>
              <dl className={styles.definitionGrid}>
                <div>
                  <dt>Vuelo asociado</dt>
                  <dd>{flight ? `${flight.flightNumber} · ${flight.origin} → ${flight.destination}` : "Solicitud general"}</dd>
                </div>
                <div>
                  <dt>Requerido para</dt>
                  <dd>{formatDateTime(request.requestedFor, timeMode)}</dd>
                </div>
                <div>
                  <dt>Registrada</dt>
                  <dd>{formatDateTime(request.createdAt, timeMode)}</dd>
                </div>
                <div>
                  <dt>Última actualización</dt>
                  <dd>{formatDateTime(request.updatedAt, timeMode)}</dd>
                </div>
              </dl>
              {request.cancellationReason && (
                <Feedback tone="info">Motivo de cancelación: {request.cancellationReason}</Feedback>
              )}
              {request.decisionNote && (
                <Feedback tone={request.status === "REJECTED" ? "error" : "success"}>
                  Respuesta de Contratos: {request.decisionNote}
                </Feedback>
              )}
              <div className={styles.cardFooter}>
                <Provenance value={request.provenance} />
                {request.status === "SUBMITTED" && (
                  <button
                    className={styles.dangerButton}
                    type="button"
                    onClick={() => setDialog({ kind: "cancel", id: request.id })}
                  >
                    Cancelar solicitud
                  </button>
                )}
              </div>
            </article>
          );
        }) : (
          <Panel>
            <EmptyState
              title={loading ? "Consultando solicitudes" : "No hay solicitudes para mostrar"}
              description={loading ? "Conectando con Contratos…" : "Ajusta los filtros o registra una nueva solicitud operacional."}
            />
          </Panel>
        )}
      </div>

      {dialog?.kind === "create" && (
        <PortalModal
          title="Nueva solicitud"
          description="AVIAM recibirá la solicitud para validarla; la operación no cambia hasta que sea aprobada."
          onClose={() => setDialog(null)}
        >
          <form className={styles.modalForm} onSubmit={submit}>
            <div className={styles.formGrid}>
              <Field label="Estación" htmlFor="request-station" required>
                <select id="request-station" name="station" required defaultValue={session?.stations.primary}>
                  {session?.stations.authorized.map((stationCode) => (
                    <option key={stationCode} value={stationCode}>{stationCode}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo de solicitud" htmlFor="request-type" required>
                <select id="request-type" name="type" required defaultValue="ADDITIONAL_SERVICE">
                  {Object.entries(REQUEST_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Vuelo" htmlFor="request-flight" hint="Opcional para solicitudes generales.">
                <select id="request-flight" name="flightId" defaultValue="">
                  <option value="">Sin vuelo específico</option>
                  {data.flights.filter((flight) => flight.status !== "CANCELLED").map((flight) => (
                    <option key={flight.id} value={flight.id}>
                      {flight.flightNumber} · {flight.origin} → {flight.destination}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha requerida" htmlFor="request-date" required>
                <input id="request-date" name="requestedFor" type="datetime-local" min={futureLocalDateTime()} defaultValue={futureLocalDateTime()} required />
              </Field>
              <div className={styles.fieldWide}>
                <Field label="Título" htmlFor="request-title" required>
                  <input id="request-title" name="title" maxLength={120} required placeholder="Ej. Escalera adicional para desembarque" />
                </Field>
              </div>
              <div className={styles.fieldWide}>
                <Field label="Detalle operacional" htmlFor="request-description" required>
                  <textarea id="request-description" name="description" maxLength={1_000} required placeholder="Describe el requerimiento, cantidad y cualquier condición relevante." />
                </Field>
              </div>
            </div>
            <Feedback tone="info">Se registrará como “Recibida” y quedará vinculada a tu usuario y aerolínea.</Feedback>
            <div className={styles.modalActions}>
              <button className={styles.ghostButton} type="button" onClick={() => setDialog(null)}>Volver</button>
              <button className={styles.primaryButton} type="submit"><PlaneIcon /> Enviar solicitud</button>
            </div>
          </form>
        </PortalModal>
      )}

      {dialog?.kind === "cancel" && (
        <PortalModal
          title="Cancelar solicitud"
          description="Solo las solicitudes todavía recibidas pueden cancelarse. La acción quedará auditada."
          onClose={() => setDialog(null)}
        >
          <form className={styles.modalForm} onSubmit={submit}>
            <Field label="Motivo de cancelación" htmlFor="cancel-reason" required>
              <textarea id="cancel-reason" name="reason" maxLength={500} required placeholder="Indica por qué ya no se requiere el servicio." />
            </Field>
            <div className={styles.modalActions}>
              <button className={styles.ghostButton} type="button" onClick={() => setDialog(null)}>Conservar solicitud</button>
              <button className={styles.dangerButton} type="submit">Confirmar cancelación</button>
            </div>
          </form>
        </PortalModal>
      )}
    </div>
  );
}
