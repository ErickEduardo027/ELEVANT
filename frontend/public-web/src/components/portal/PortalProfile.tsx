"use client";

import { useState } from "react";

import { useMockSession } from "@/components/auth/MockSessionProvider";
import type { MockPermission } from "@/lib/mock-auth";

import { DatabaseIcon, RefreshIcon, UserIcon } from "./PortalIcons";
import {
  Feedback,
  Panel,
  PortalModal,
  PortalPageHeader,
  formatDateTime,
  portalModuleStyles as styles,
} from "./PortalModuleUI";
import { usePortalWorkspace } from "./PortalWorkspace";

const PERMISSION_LABELS: Record<MockPermission, string> = {
  "portal:access": "Acceso al portal",
  "flights:read": "Consultar vuelos",
  "operations:read": "Consultar operaciones",
  "contracts:read": "Consultar contratos",
  "evidence:read": "Consultar evidencias",
  "documents:read": "Consultar documentos",
  "billing:read": "Consultar finanzas",
  "billing:respond": "Responder finanzas",
  "reports:read": "Consultar reportes",
  "reports:export": "Exportar reportes",
  "service-requests:read": "Consultar solicitudes",
  "service-requests:create": "Crear solicitudes",
  "service-requests:cancel": "Cancelar solicitudes recibidas",
  "notifications:read": "Consultar notificaciones",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "service_request.created": "Solicitud creada",
  "service_request.cancelled": "Solicitud cancelada",
  "prebill.accepted": "Prefactura aceptada",
  "prebill.disputed": "Prefactura disputada",
  "reconciliation.accepted": "Conciliación aceptada",
  "reconciliation.disputed": "Conciliación disputada",
  "invoice.claimed": "Reclamo de factura creado",
  "billing_case.created": "Caso financiero creado",
  "notification.read": "Notificación consultada",
  "notification.read_all": "Notificaciones consultadas",
  "document.downloaded": "Documento descargado",
};

export function PortalProfile() {
  const { session } = useMockSession();
  const {
    data,
    timeMode,
    setTimeMode,
    lastRefreshedAt,
    resetDemo,
  } = usePortalWorkspace();
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!session) return null;

  const handleReset = () => {
    resetDemo();
    setConfirmReset(false);
    setFeedback("Los datos locales del portal volvieron a su estado inicial de demostración.");
  };

  return (
    <div className={styles.page}>
      <PortalPageHeader
        eyebrow="Cuenta autorizada"
        title="Tu alcance, siempre visible."
        description="Consulta la organización, estaciones y permisos asociados a esta sesión. En la primera versión estos datos son administrados por AVIAM."
      />

      {feedback && <Feedback tone="success">{feedback}</Feedback>}

      <section className={styles.profileHero} aria-labelledby="profile-airline-name">
        <span>AIRLINE_ADMIN · DEMO LOCAL</span>
        <h2 id="profile-airline-name">{session.airline.displayName}</h2>
        <p>{session.user.fullName} · {session.user.title}</p>
        <ul className={styles.stationList} aria-label="Estaciones autorizadas">
          {session.stations.authorized.map((station) => <li key={station}>{station}</li>)}
        </ul>
      </section>

      <div className={styles.profileGrid}>
        <Panel title="Identidad de la aerolínea" description="Información aprobada para esta sesión.">
          <dl className={styles.definitionGrid}>
            <div><dt>Razón social</dt><dd>{session.airline.legalName}</dd></div>
            <div><dt>Nombre comercial</dt><dd>{session.airline.displayName}</dd></div>
            <div><dt>IATA</dt><dd>{session.airline.iataCode ?? "No informado"}</dd></div>
            <div><dt>ICAO</dt><dd>{session.airline.icaoCode ?? "No informado"}</dd></div>
            <div><dt>País</dt><dd>{session.airline.country}</dd></div>
            <div><dt>Tenant</dt><dd className={styles.mono}>{session.airlineId}</dd></div>
          </dl>
        </Panel>

        <Panel title="Usuario responsable" description="Identidad vinculada a las respuestas auditables.">
          <dl className={styles.definitionGrid}>
            <div><dt>Nombre</dt><dd>{session.user.fullName}</dd></div>
            <div><dt>Cargo</dt><dd>{session.user.title}</dd></div>
            <div><dt>Correo</dt><dd>{session.user.email}</dd></div>
            <div><dt>Rol</dt><dd>Administrador de aerolínea</dd></div>
            <div><dt>Sesión emitida</dt><dd>{formatDateTime(session.issuedAt, timeMode)}</dd></div>
            <div><dt>Expira</dt><dd>{formatDateTime(session.expiresAt, timeMode)}</dd></div>
          </dl>
        </Panel>
      </div>

      <div className={styles.profileGrid}>
        <Panel title="Preferencia horaria" description="Cambia cómo se presentan las horas en todo el portal.">
          <div className={styles.toggleGroup} role="group" aria-label="Zona horaria de visualización">
            <button type="button" data-active={timeMode === "AIRPORT" || undefined} onClick={() => setTimeMode("AIRPORT")}>
              Hora local PUJ
            </button>
            <button type="button" data-active={timeMode === "UTC" || undefined} onClick={() => setTimeMode("UTC")}>
              Hora UTC
            </button>
          </div>
          <p className={styles.pageDescription}>
            Última actualización manual: {formatDateTime(lastRefreshedAt.toISOString(), timeMode)}.
          </p>
        </Panel>

        <Panel title="Estaciones autorizadas" description="El repositorio oculta cualquier registro fuera de este alcance.">
          <ul className={styles.stationList}>
            {session.stations.authorized.map((station) => (
              <li key={station}>
                {station}{station === session.stations.primary ? " · Principal" : ""}
              </li>
            ))}
          </ul>
          <Feedback tone="info">La estación primaria activa es {session.stations.primary}.</Feedback>
        </Panel>
      </div>

      <Panel title="Permisos de la primera versión" description="Consulta amplia; escritura limitada a solicitudes y respuestas financieras.">
        <ul className={styles.permissionList}>
          {session.permissions.map((permission) => (
            <li key={permission}>{PERMISSION_LABELS[permission]}</li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="Actividad auditable"
        description="Acciones realizadas por usuarios de esta aerolínea en el entorno local."
        action={<DatabaseIcon aria-hidden="true" width={20} />}
      >
        {data.audits.length ? (
          <ol className={styles.auditList}>
            {data.audits.slice(0, 12).map((audit) => (
              <li key={audit.id}>
                <strong>{AUDIT_ACTION_LABELS[audit.action] ?? audit.action}</strong>
                <span>{formatDateTime(audit.occurredAt, timeMode)} · {audit.actorName} · {audit.entityId}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Feedback tone="info">Todavía no hay acciones registradas en esta sesión.</Feedback>
        )}
      </Panel>

      <Panel title="Controles de demostración" description="Restablece únicamente datos mock de este tenant; no cierra tu sesión.">
        <div className={styles.actionsRow}>
          <button className={styles.dangerButton} type="button" onClick={() => setConfirmReset(true)}>
            <RefreshIcon /> Restablecer datos demo
          </button>
          <span className={styles.muted}><UserIcon aria-hidden="true" width={16} /> Sesión local, sin conexión a una operación real.</span>
        </div>
      </Panel>

      {confirmReset && (
        <PortalModal
          title="Restablecer datos demo"
          description="Se eliminarán solicitudes, respuestas, casos, lecturas y auditoría creados localmente para esta aerolínea."
          onClose={() => setConfirmReset(false)}
        >
          <div className={styles.modalForm}>
            <Feedback tone="info">La sesión y la solicitud de afiliación no se eliminarán.</Feedback>
            <div className={styles.modalActions}>
              <button className={styles.ghostButton} type="button" onClick={() => setConfirmReset(false)}>Conservar datos</button>
              <button className={styles.dangerButton} type="button" onClick={handleReset}>Sí, restablecer</button>
            </div>
          </div>
        </PortalModal>
      )}
    </div>
  );
}
