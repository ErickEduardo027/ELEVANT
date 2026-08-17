"use client";

import { useMemo, useState } from "react";

import { FileIcon, SearchIcon } from "./PortalIcons";
import {
  EmptyState,
  Feedback,
  formatBytes,
  formatDateTime,
  Panel,
  PortalPageHeader,
  Provenance,
  StatusBadge,
  portalModuleStyles as styles,
} from "./PortalModuleUI";
import { usePortalWorkspace } from "./PortalWorkspace";

const TYPE_LABELS = {
  SERVICE_ORDER: "Orden de servicio",
  OPERATION_REPORT: "Reporte operativo",
  EVIDENCE: "Evidencia",
  CONTRACT: "Contrato",
  INVOICE: "Factura",
} as const;

function fileFormat(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "image/jpeg") return "JPG";
  if (mimeType === "image/png") return "PNG";
  return mimeType;
}

export function PortalDocuments() {
  const { data, downloadDocument, timeMode } = usePortalWorkspace();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [station, setStation] = useState("ALL");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  const stations = useMemo(
    () => [...new Set(data.documents.map((document) => document.station))].sort(),
    [data.documents],
  );

  const documents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return data.documents.filter((document) => {
      const flight = data.flights.find((item) => item.id === document.flightId);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [document.name, document.id, document.operationId, flight?.flightNumber]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("es")
          .includes(normalizedQuery);
      return (
        matchesQuery &&
        (type === "ALL" || document.type === type) &&
        (status === "ALL" || document.status === status) &&
        (station === "ALL" || document.station === station)
      );
    });
  }, [data.documents, data.flights, query, station, status, type]);

  const auditCount = data.audits.filter(
    (audit) => audit.action === "document.downloaded",
  ).length;

  const handleDownload = async (id: string, name: string) => {
    setDownloadingId(id);
    setFeedback(null);
    const result = await downloadDocument(id);
    setDownloadingId(null);
    setFeedback(
      result.ok
        ? {
            tone: "success",
            message: `${name} se descargó y la consulta quedó registrada en la auditoría.`,
          }
        : { tone: "error", message: result.message },
    );
  };

  return (
    <div className={styles.page}>
      <PortalPageHeader
        eyebrow="Repositorio autorizado"
        title="Documentos de la operación"
        description="Encuentra reportes, evidencias y soportes disponibles para tu aerolínea. Cada descarga autorizada queda trazada en el historial del portal."
      />

      <section className={styles.metricGrid} aria-label="Resumen documental">
        <article className={styles.metricCard}>
          <span>Documentos visibles</span>
          <strong>{data.documents.length}</strong>
          <small>Restringidos a tu aerolínea y estaciones</small>
        </article>
        <article className={styles.metricCard}>
          <span>Disponibles</span>
          <strong>
            {data.documents.filter((document) => document.status === "AVAILABLE").length}
          </strong>
          <small>Listos para descargar</small>
        </article>
        <article className={styles.metricCard}>
          <span>En procesamiento</span>
          <strong>
            {data.documents.filter((document) => document.status === "PROCESSING").length}
          </strong>
          <small>Se habilitarán al completar su publicación</small>
        </article>
        <article className={styles.metricCard}>
          <span>Descargas auditadas</span>
          <strong>{auditCount}</strong>
          <small>Registradas en esta sesión demo</small>
        </article>
      </section>

      <div
        className={`${styles.toolbar} ${styles.documentToolbar}`}
        role="search"
        aria-label="Filtrar documentos"
      >
        <div className={styles.searchControl}>
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar documento, vuelo u operación"
            aria-label="Buscar documentos"
          />
        </div>
        <div className={styles.selectControl}>
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-label="Filtrar por tipo de documento"
          >
            <option value="ALL">Todos los tipos</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.selectControl}>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filtrar por estado"
          >
            <option value="ALL">Todos los estados</option>
            <option value="AVAILABLE">Disponibles</option>
            <option value="PROCESSING">En procesamiento</option>
            <option value="REVOKED">Revocados</option>
          </select>
        </div>
        <div className={styles.selectControl}>
          <select
            value={station}
            onChange={(event) => setStation(event.target.value)}
            aria-label="Filtrar por estación"
          >
            <option value="ALL">Todas las estaciones</option>
            {stations.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>

      {feedback && <Feedback tone={feedback.tone}>{feedback.message}</Feedback>}

      <Panel
        title="Archivos disponibles"
        description={`${documents.length} ${documents.length === 1 ? "resultado" : "resultados"} según los filtros aplicados.`}
      >
        {documents.length === 0 ? (
          <EmptyState
            title="No encontramos documentos"
            description="Cambia la búsqueda o los filtros para consultar otro conjunto de archivos."
          />
        ) : (
          <div className={styles.documentList}>
            {documents.map((document) => {
              const flight = data.flights.find((item) => item.id === document.flightId);
              const canDownload = document.status === "AVAILABLE";
              return (
                <article className={styles.documentRow} key={document.id}>
                  <div className={styles.documentFileIcon} aria-hidden="true">
                    <FileIcon />
                    <span>{fileFormat(document.mimeType)}</span>
                  </div>
                  <div className={styles.documentIdentity}>
                    <div className={styles.documentTitleRow}>
                      <div>
                        <p>{TYPE_LABELS[document.type]}</p>
                        <h2>{document.name}</h2>
                      </div>
                      <StatusBadge status={document.status} />
                    </div>
                    <dl className={styles.documentMeta}>
                      <div>
                        <dt>Vuelo</dt>
                        <dd>{flight?.flightNumber ?? "No asociado"}</dd>
                      </div>
                      <div>
                        <dt>Operación</dt>
                        <dd className={styles.mono}>{document.operationId ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Estación</dt>
                        <dd>{document.station}</dd>
                      </div>
                      <div>
                        <dt>Publicado</dt>
                        <dd>{formatDateTime(document.createdAt, timeMode)}</dd>
                      </div>
                      <div>
                        <dt>Tamaño</dt>
                        <dd>{formatBytes(document.sizeBytes)}</dd>
                      </div>
                    </dl>
                    <Provenance value={document.provenance} />
                  </div>
                  <div className={styles.documentAction}>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      disabled={!canDownload || downloadingId !== null}
                      onClick={() => handleDownload(document.id, document.name)}
                      aria-describedby={!canDownload ? `${document.id}-availability` : undefined}
                    >
                      <FileIcon />
                      {downloadingId === document.id ? "Generando…" : "Descargar"}
                    </button>
                    {!canDownload && (
                      <small id={`${document.id}-availability`}>
                        Disponible al finalizar el procesamiento
                      </small>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default PortalDocuments;
