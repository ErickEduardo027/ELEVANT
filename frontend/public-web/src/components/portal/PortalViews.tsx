"use client";

import Link from "next/link";
import type { ChangeEvent, ReactNode } from "react";

import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClipboardIcon,
  ClockIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileIcon,
  PlaneIcon,
  RefreshIcon,
  SearchIcon,
} from "./PortalIcons";
import {
  formatPortalDateTime,
  formatPortalTime,
  splitRoute,
  statusTone,
} from "./portal-format";
import {
  sourceDetail,
  sourceLabel,
  type PortalDocument,
  type PortalFlight,
  type PortalFlightFilters,
  type PortalIncident,
  type PortalOverview,
  type PortalSource,
  type PortalTimelineEvent,
} from "./portal-types";
import styles from "./PortalViews.module.css";

type RefreshProps = {
  onRefresh?: () => void;
  isRefreshing?: boolean;
};

function RefreshButton({ onRefresh, isRefreshing }: RefreshProps) {
  if (!onRefresh) return null;
  return (
    <button
      className={styles.secondaryButton}
      type="button"
      disabled={isRefreshing}
      onClick={onRefresh}
    >
      <RefreshIcon />
      {isRefreshing ? "Actualizando" : "Actualizar datos"}
    </button>
  );
}

function StatusPill({ children }: { children: ReactNode }) {
  const status = String(children ?? "");
  return (
    <span className={styles.statusPill} data-tone={statusTone(status)}>
      <i aria-hidden="true" />
      {status || "Sin estado"}
    </span>
  );
}

function SourceTag({ source }: { source?: PortalSource }) {
  const detail = sourceDetail(source);
  return (
    <span className={styles.sourceTag} title={detail ?? undefined}>
      <DatabaseIcon />
      <span>{sourceLabel(source)}</span>
    </span>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.emptyState} role="status">
      <span aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.pageLead}>{description}</p>
      </div>
      {action && <div className={styles.pageAction}>{action}</div>}
    </header>
  );
}

function RotationRoute({ flight, compact = false }: { flight: PortalFlight; compact?: boolean }) {
  const [origin, destination] = splitRoute(flight.route);
  return (
    <div className={styles.rotationRoute} data-compact={compact || undefined}>
      <span>{origin}</span>
      <span className={styles.rotationTrack} aria-hidden="true">
        <i />
        <PlaneIcon />
        <i />
      </span>
      <span>{destination}</span>
    </div>
  );
}

function FlightStrip({ flight }: { flight: PortalFlight }) {
  return (
    <article className={styles.flightStrip}>
      <div className={styles.flightIdentity}>
        <span>{flight.flightNumber}</span>
        <small>{flight.operationId}</small>
      </div>
      <RotationRoute flight={flight} compact />
      <div className={styles.flightTime}>
        <span>Estimada</span>
        <time dateTime={flight.estimatedAt}>{formatPortalTime(flight.estimatedAt)}</time>
      </div>
      <div className={styles.flightStatuses}>
        <StatusPill>{flight.flightStatus}</StatusPill>
        <StatusPill>{flight.operationStatus}</StatusPill>
      </div>
      <Link
        className={styles.flightLink}
        href={`/portal/vuelos/${encodeURIComponent(flight.operationId)}`}
        aria-label={`Ver detalle del vuelo ${flight.flightNumber}`}
      >
        <span>Ver rotación</span>
        <ArrowRightIcon />
      </Link>
    </article>
  );
}

export interface PortalOverviewViewProps extends RefreshProps {
  overview: PortalOverview;
  station?: string;
}

export function PortalOverviewView({
  overview,
  station,
  onRefresh,
  isRefreshing,
}: PortalOverviewViewProps) {
  const visibleStation = station || overview.activeFlights[0]?.station || "tu estación";

  return (
    <div className={styles.viewStack}>
      <section className={styles.overviewHero} aria-labelledby="overview-title">
        <div className={styles.overviewHeading}>
          <p className={styles.eyebrow}>Vista autorizada · {visibleStation}</p>
          <h1 id="overview-title">Tu operación, en una sola secuencia.</h1>
          <p>
            Consulta vuelos, hitos y evidencias sin intervenir en la ejecución del
            centro de operaciones.
          </p>
          <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
        </div>
        <div className={styles.heroTrace} aria-hidden="true">
          <span>PLAN</span>
          <i />
          <span>RAMPA</span>
          <i />
          <span>EVIDENCIA</span>
          <PlaneIcon />
        </div>
      </section>

      <dl className={styles.kpiGrid} aria-label="Indicadores de la operación">
        {overview.kpis.map((kpi, index) => (
          <div key={kpi.id ?? `${kpi.label}-${index}`} data-tone={kpi.tone ?? "neutral"}>
            <dt>{kpi.label}</dt>
            <dd className={styles.kpiValue}>{kpi.value}</dd>
            <dd className={styles.kpiDetail}>
              {kpi.detail ?? "Actualizado con la última fuente disponible"}
            </dd>
          </div>
        ))}
      </dl>

      <div className={styles.overviewGrid}>
        <section className={styles.panel} aria-labelledby="active-flights-title">
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.panelKicker}>Ahora</p>
              <h2 id="active-flights-title">Vuelos activos</h2>
            </div>
            <Link href="/portal/vuelos">
              Ver todos
              <ArrowRightIcon />
            </Link>
          </header>
          <div className={styles.flightList}>
            {overview.activeFlights.length ? (
              overview.activeFlights.map((flight) => (
                <FlightStrip flight={flight} key={flight.operationId} />
              ))
            ) : (
              <EmptyState
                icon={<PlaneIcon />}
                title="No hay vuelos activos"
                description="Las próximas rotaciones aparecerán cuando la fuente operacional las publique."
              />
            )}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.changesPanel}`} aria-labelledby="changes-title">
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.panelKicker}>Trazabilidad</p>
              <h2 id="changes-title">Cambios recientes</h2>
            </div>
          </header>
          {overview.recentChanges.length ? (
            <ol className={styles.changeTimeline}>
              {overview.recentChanges.map((change, index) => (
                <li key={change.id ?? `${change.at}-${index}`}>
                  <span className={styles.timelineDot} aria-hidden="true" />
                  <div>
                    <time dateTime={change.at}>{formatPortalDateTime(change.at)}</time>
                    <strong>{change.title}</strong>
                    {change.description && <p>{change.description}</p>}
                    <div className={styles.changeMeta}>
                      {change.flightNumber && <span>{change.flightNumber}</span>}
                      <SourceTag source={change.source} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              icon={<ClockIcon />}
              title="Sin cambios recientes"
              description="La bitácora mostrará aquí cada actualización recibida."
            />
          )}
        </section>
      </div>
    </div>
  );
}

export interface PortalFlightSummaryViewProps extends RefreshProps {
  flights: PortalFlight[];
  filters: PortalFlightFilters;
  onFiltersChange: (filters: PortalFlightFilters) => void;
}

export function PortalFlightSummaryView({
  flights,
  filters,
  onFiltersChange,
  onRefresh,
  isRefreshing,
}: PortalFlightSummaryViewProps) {
  const statuses = [...new Set(flights.map((flight) => flight.flightStatus).filter(Boolean))];
  const stations = [...new Set(flights.map((flight) => flight.station).filter(Boolean))];

  const updateFilter =
    (key: keyof PortalFlightFilters) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onFiltersChange({ ...filters, [key]: event.target.value });
    };

  return (
    <div className={styles.viewStack}>
      <PageHeading
        eyebrow="Rotaciones autorizadas"
        title="Vuelos"
        description="Filtra la operación y abre una rotación para revisar servicios, SLA y procedencia de cada hito."
        action={<RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />}
      />

      <section className={styles.filterPanel} aria-label="Filtros de vuelos">
        <label className={styles.searchField}>
          <span>Buscar vuelo, ruta o matrícula</span>
          <span className={styles.inputShell}>
            <SearchIcon aria-hidden="true" />
            <input
              type="search"
              value={filters.query}
              placeholder="Ej. EV 402, PUJ o HI-123"
              onChange={updateFilter("query")}
            />
          </span>
        </label>
        <label>
          <span>Estado del vuelo</span>
          <select value={filters.status} onChange={updateFilter("status")}>
            <option value="">Todos los estados</option>
            {statuses.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Estación</span>
          <select value={filters.station} onChange={updateFilter("station")}>
            <option value="">Todas las estaciones</option>
            {stations.map((station) => (
              <option value={station} key={station}>
                {station}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.panel} aria-labelledby="flight-results-title">
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.panelKicker}>Consulta de solo lectura</p>
            <h2 id="flight-results-title">{flights.length} rotaciones</h2>
          </div>
          <span className={styles.readOnlyFlag}>
            <CheckIcon />
            Datos verificables
          </span>
        </header>

        {flights.length ? (
          <>
            <div className={styles.flightTableWrap}>
              <table className={styles.flightTable}>
                <caption className={styles.srOnly}>
                  Vuelos disponibles según los filtros aplicados
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Vuelo</th>
                    <th scope="col">Ruta</th>
                    <th scope="col">Programada / estimada</th>
                    <th scope="col">Posición</th>
                    <th scope="col">Estado</th>
                    <th scope="col">
                      <span className={styles.srOnly}>Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {flights.map((flight) => (
                    <tr key={flight.operationId}>
                      <th scope="row">
                        <Link href={`/portal/vuelos/${encodeURIComponent(flight.operationId)}`}>
                          {flight.flightNumber}
                        </Link>
                        <small>{flight.registration}</small>
                      </th>
                      <td>
                        <RotationRoute flight={flight} compact />
                      </td>
                      <td>
                        <time dateTime={flight.scheduledAt}>
                          {formatPortalDateTime(flight.scheduledAt)}
                        </time>
                        <small>Est. {formatPortalTime(flight.estimatedAt)}</small>
                      </td>
                      <td>
                        <strong>{flight.station}</strong>
                        <small>{flight.stand || "Sin posición"}</small>
                      </td>
                      <td>
                        <StatusPill>{flight.flightStatus}</StatusPill>
                        <small>{flight.operationStatus}</small>
                      </td>
                      <td>
                        <Link
                          className={styles.iconLink}
                          href={`/portal/vuelos/${encodeURIComponent(flight.operationId)}`}
                          aria-label={`Abrir rotación ${flight.flightNumber}`}
                        >
                          <ArrowRightIcon />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={styles.flightCards}>
              {flights.map((flight) => (
                <FlightStrip flight={flight} key={flight.operationId} />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<SearchIcon />}
            title="No encontramos rotaciones"
            description="Ajusta los filtros o espera la próxima actualización de la fuente operacional."
          />
        )}
      </section>
    </div>
  );
}

function Timeline({ events }: { events: PortalTimelineEvent[] }) {
  if (!events.length) {
    return (
      <EmptyState
        icon={<ClockIcon />}
        title="Sin hitos publicados"
        description="La secuencia aparecerá cuando se reciban eventos de la rotación."
      />
    );
  }

  return (
    <ol className={styles.operationTimeline}>
      {events.map((event, index) => (
        <li key={event.id ?? `${event.at}-${index}`}>
          <div className={styles.operationTime}>
            <time dateTime={event.at}>{formatPortalTime(event.at)}</time>
            <span>{formatPortalDateTime(event.at)}</span>
          </div>
          <span className={styles.operationNode} aria-hidden="true">
            <i />
          </span>
          <div className={styles.operationEvent}>
            <div>
              <strong>{event.title}</strong>
              {event.status && <StatusPill>{event.status}</StatusPill>}
            </div>
            {event.description && <p>{event.description}</p>}
            <SourceTag source={event.source} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function IncidentList({ incidents }: { incidents: PortalIncident[] }) {
  if (!incidents.length) {
    return (
      <div className={styles.clearState}>
        <CheckIcon />
        <div>
          <strong>Sin incidencias abiertas</strong>
          <p>No hay afectaciones reportadas para esta rotación.</p>
        </div>
      </div>
    );
  }

  return (
    <ul className={styles.incidentList}>
      {incidents.map((incident, index) => (
        <li key={incident.id ?? `${incident.title}-${index}`}>
          <AlertIcon />
          <div>
            <span>{incident.severity ?? "Incidencia"}</span>
            <strong>{incident.title}</strong>
            {incident.summary && <p>{incident.summary}</p>}
            <div>
              <StatusPill>{incident.status}</StatusPill>
              {incident.updatedAt && (
                <time dateTime={incident.updatedAt}>
                  {formatPortalDateTime(incident.updatedAt)}
                </time>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DocumentList({ documents }: { documents: PortalDocument[] }) {
  if (!documents.length) {
    return (
      <EmptyState
        icon={<FileIcon />}
        title="Sin documentos asociados"
        description="Los archivos autorizados aparecerán en esta sección."
      />
    );
  }

  return (
    <ul className={styles.documentList}>
      {documents.map((document, index) => (
        <li key={document.id ?? `${document.name}-${index}`}>
          <span className={styles.documentIcon} aria-hidden="true">
            <FileIcon />
          </span>
          <div>
            <strong>{document.name}</strong>
            <span>
              {document.category ?? "Documento"}
              {document.updatedAt ? ` · ${formatPortalDateTime(document.updatedAt)}` : ""}
            </span>
          </div>
          {document.href ? (
            <a href={document.href} aria-label={`Ver ${document.name}`}>
              <ExternalLinkIcon />
            </a>
          ) : (
            <span className={styles.documentReadOnly}>Solo lectura</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface PortalFlightDetailViewProps extends RefreshProps {
  flight: PortalFlight;
}

export function PortalFlightDetailView({
  flight,
  onRefresh,
  isRefreshing,
}: PortalFlightDetailViewProps) {
  const [origin, destination] = splitRoute(flight.route);

  return (
    <div className={styles.viewStack}>
      <div className={styles.detailToolbar}>
        <Link href="/portal/vuelos">
          <ChevronLeftIcon />
          Volver a vuelos
        </Link>
        <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
      </div>

      <section className={styles.flightHero} aria-labelledby="flight-detail-title">
        <div className={styles.flightHeroTopline}>
          <div>
            <p className={styles.eyebrow}>Rotación · {flight.operationId}</p>
            <h1 id="flight-detail-title">{flight.flightNumber}</h1>
          </div>
          <div className={styles.flightHeroStatuses}>
            <StatusPill>{flight.flightStatus}</StatusPill>
            <StatusPill>{flight.operationStatus}</StatusPill>
          </div>
        </div>

        <div className={styles.flightRouteHero}>
          <div>
            <strong>{origin}</strong>
            <span>Origen</span>
          </div>
          <div className={styles.flightPath} aria-hidden="true">
            <span />
            <PlaneIcon />
            <span />
          </div>
          <div>
            <strong>{destination}</strong>
            <span>Destino</span>
          </div>
        </div>

        <dl className={styles.flightFacts}>
          <div>
            <dt>Programada</dt>
            <dd>
              <time dateTime={flight.scheduledAt}>
                {formatPortalDateTime(flight.scheduledAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt>Estimada</dt>
            <dd>
              <time dateTime={flight.estimatedAt}>
                {formatPortalDateTime(flight.estimatedAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt>Aeronave</dt>
            <dd>{flight.aircraft || "—"}</dd>
            <span>{flight.registration || "Sin matrícula"}</span>
          </div>
          <div>
            <dt>Estación / posición</dt>
            <dd>{flight.station || "—"}</dd>
            <span>{flight.stand || "Pendiente"}</span>
          </div>
        </dl>

        <div className={styles.heroProvenance}>
          <SourceTag source={flight.source} />
          <span>
            Actualizado <time dateTime={flight.updatedAt}>{formatPortalDateTime(flight.updatedAt)}</time>
          </span>
        </div>
      </section>

      <div className={styles.detailGrid}>
        <div className={styles.detailMain}>
          <section className={styles.panel} aria-labelledby="services-title">
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.panelKicker}>Cobertura contratada</p>
                <h2 id="services-title">Servicios y SLA</h2>
              </div>
              <span className={styles.readOnlyFlag}>Solo lectura</span>
            </header>
            {flight.services.length ? (
              <div className={styles.serviceList}>
                {flight.services.map((service, index) => (
                  <article key={service.id ?? `${service.name}-${index}`}>
                    <div>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <strong>{service.name}</strong>
                        <small>{service.owner ?? "Responsable operacional"}</small>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>SLA</dt>
                        <dd>{service.sla ?? "No informado"}</dd>
                      </div>
                      <div>
                        <dt>Programado</dt>
                        <dd>{formatPortalTime(service.scheduledAt)}</dd>
                      </div>
                      <div>
                        <dt>Completado</dt>
                        <dd>{formatPortalTime(service.completedAt)}</dd>
                      </div>
                    </dl>
                    <div className={styles.serviceStatus}>
                      <StatusPill>{service.status}</StatusPill>
                      <SourceTag source={service.source} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ClipboardIcon />}
                title="Sin servicios publicados"
                description="El detalle contractual aparecerá cuando esté asociado a la rotación."
              />
            )}
          </section>

          <section className={styles.panel} aria-labelledby="timeline-title">
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.panelKicker}>Del plan a la evidencia</p>
                <h2 id="timeline-title">Línea de tiempo</h2>
              </div>
            </header>
            <Timeline events={flight.timeline} />
          </section>
        </div>

        <aside className={styles.detailAside} aria-label="Contexto de la rotación">
          <section className={styles.panel} aria-labelledby="incidents-title">
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.panelKicker}>Seguimiento</p>
                <h2 id="incidents-title">Incidencias</h2>
              </div>
              <span className={styles.countBadge}>{flight.incidents.length}</span>
            </header>
            <IncidentList incidents={flight.incidents} />
          </section>

          <section className={styles.panel} aria-labelledby="documents-title">
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.panelKicker}>Evidencia autorizada</p>
                <h2 id="documents-title">Documentos</h2>
              </div>
              <span className={styles.countBadge}>{flight.documents.length}</span>
            </header>
            <DocumentList documents={flight.documents} />
          </section>
        </aside>
      </div>
    </div>
  );
}
