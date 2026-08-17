"use client";

import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { DataProvenance } from "@/lib/portal";

import { CloseIcon, DatabaseIcon } from "./PortalIcons";
import { usePortalWorkspace } from "./PortalWorkspace";
import styles from "./PortalModules.module.css";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Activo",
  DRAFT: "Borrador",
  EXPIRED: "Vencido",
  AVAILABLE: "Disponible",
  PROCESSING: "Procesando",
  REVOKED: "Revocado",
  PENDING_REVIEW: "Pendiente de revisión",
  ACCEPTED: "Aceptado",
  DISPUTED: "En disputa",
  ISSUED: "Emitida",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  MATCHED: "Sin diferencias",
  SUBMITTED: "Recibida",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  CANCELLED: "Cancelada",
  OPEN: "Abierto",
  UNDER_REVIEW: "En análisis",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
  SCHEDULED: "Programado",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completado",
};

const SOURCE_LABELS: Record<DataProvenance["source"], string> = {
  ELEVANT_CORE: "ELEVANT Core",
  AIRLINE_PORTAL: "Portal de aerolínea",
  ERP: "ERP financiero",
  DOCUMENT_STORE: "Repositorio documental",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

function statusTone(status: string): "positive" | "attention" | "critical" | "neutral" {
  if (["ACTIVE", "AVAILABLE", "ACCEPTED", "PAID", "MATCHED", "APPROVED", "COMPLETED"].includes(status)) {
    return "positive";
  }
  if (["PENDING_REVIEW", "PROCESSING", "SUBMITTED", "IN_REVIEW", "IN_PROGRESS", "SCHEDULED", "OPEN", "UNDER_REVIEW", "ISSUED"].includes(status)) {
    return "attention";
  }
  if (["DISPUTED", "OVERDUE", "REJECTED", "CANCELLED", "REVOKED"].includes(status)) {
    return "critical";
  }
  return "neutral";
}

export function formatMoney(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(
  value: string | null | undefined,
  timeMode: "AIRPORT" | "UTC" = "AIRPORT",
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("es-DO", {
    timeZone: timeMode === "UTC" ? "UTC" : "America/Santo_Domingo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatBytes(value: number): string {
  if (value <= 0) return "Pendiente";
  if (value < 1_024_000) return `${Math.ceil(value / 1_024)} KB`;
  return `${(value / 1_024_000).toFixed(1)} MB`;
}

export function PortalPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.pageDescription}>{description}</p>
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className}`}>
      {(title || description || action) && (
        <div className={styles.panelHeader}>
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={styles.statusBadge} data-tone={statusTone(status)}>
      <i aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

export function Provenance({ value }: { value: DataProvenance }) {
  const { timeMode } = usePortalWorkspace();
  return (
    <div className={styles.provenance} title={`Registro ${value.sourceRecordId}`}>
      <DatabaseIcon />
      <span>
        {SOURCE_LABELS[value.source]} · {value.quality === "VERIFIED" ? "Verificado" : "Reportado"}
      </span>
      <small>Actualizado {formatDateTime(value.lastSyncedAt, timeMode)}</small>
    </div>
  );
}

export function Feedback({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={styles.feedback}
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyState}>
      <span aria-hidden="true">EV</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function PortalModal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const dismissFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className={styles.modalBackdrop} onMouseDown={dismissFromBackdrop}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        ref={panelRef}
      >
        <div className={styles.modalHeader}>
          <div>
            <p className={styles.eyebrow}>Acción controlada</p>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar ventana">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>
        {label} {required && <span aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export { styles as portalModuleStyles };
