"use client";

import { useMemo, useState, useTransition } from "react";

import { useMockSession } from "@/components/auth/MockSessionProvider";
import {
  type DataProvenance,
  type MockPortalRepository,
  type Operation,
  type OperationService,
  type PortalDocument as DomainDocument,
  type PortalFlight as DomainFlight,
} from "@/lib/portal";

import { AlertIcon, PlaneIcon } from "./PortalIcons";
import type {
  PortalDocument,
  PortalFlight,
  PortalFlightFilters,
  PortalIncident,
  PortalKpi,
  PortalOverview,
  PortalSource,
  PortalTimelineEvent,
} from "./portal-types";
import {
  PortalFlightDetailView,
  PortalFlightSummaryView,
  PortalOverviewView,
} from "./PortalViews";
import { usePortalWorkspace } from "./PortalWorkspace";
import styles from "./PortalViews.module.css";

const FLIGHT_STATUS: Record<DomainFlight["status"], string> = {
  SCHEDULED: "Programado",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
};

const OPERATION_STATUS: Record<Operation["status"], string> = {
  PLANNED: "Planificada",
  IN_PROGRESS: "En rampa",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

const SERVICE_STATUS: Record<OperationService["status"], string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En proceso",
  COMPLETED: "Completado",
  NOT_EXECUTED: "No ejecutado",
};

const DOCUMENT_STATUS: Record<DomainDocument["status"], string> = {
  PROCESSING: "Procesando",
  AVAILABLE: "Disponible",
  REVOKED: "Revocado",
};

const SOURCE_LABEL: Record<DataProvenance["source"], string> = {
  ELEVANT_CORE: "ELEVANT Core",
  AIRLINE_PORTAL: "Portal de aerolínea",
  ERP: "ERP",
  DOCUMENT_STORE: "Repositorio documental",
};

function toSource(provenance: DataProvenance): PortalSource {
  return {
    label: SOURCE_LABEL[provenance.source],
    system: `${provenance.quality} · ${provenance.sourceRecordId}`,
    receivedAt: provenance.lastSyncedAt,
  };
}

function toDocuments(
  documents: DomainDocument[],
  flight: DomainFlight,
  operation: Operation | undefined,
): PortalDocument[] {
  return documents
    .filter(
      (document) =>
        document.flightId === flight.id ||
        (operation && document.operationId === operation.id),
    )
    .map((document) => ({
      id: document.id,
      name: document.name,
      category: document.type.replaceAll("_", " "),
      status: DOCUMENT_STATUS[document.status],
      updatedAt: document.createdAt,
      href: document.downloadUrl ?? undefined,
      source: toSource(document.provenance),
    }));
}

function toTimeline(
  flight: DomainFlight,
  operation: Operation | undefined,
): PortalTimelineEvent[] {
  const events: PortalTimelineEvent[] = [
    {
      id: `${flight.id}-scheduled`,
      at: flight.scheduledAt,
      title: "Vuelo programado",
      description: `${flight.origin} → ${flight.destination} publicado para ${flight.station}.`,
      status: FLIGHT_STATUS.SCHEDULED,
      source: toSource(flight.provenance),
    },
  ];

  if (flight.estimatedAt && flight.estimatedAt !== flight.scheduledAt) {
    events.push({
      id: `${flight.id}-estimated`,
      at: flight.provenance.lastSyncedAt,
      title: "Estimación actualizada",
      description: "La fuente operacional comunicó una nueva hora estimada.",
      status: "Actualizado",
      source: toSource(flight.provenance),
    });
  }

  if (operation?.startedAt) {
    events.push({
      id: `${operation.id}-started`,
      at: operation.startedAt,
      title: "Operación en rampa iniciada",
      description: `Equipo responsable: ${operation.assignedTeam}.`,
      status: OPERATION_STATUS.IN_PROGRESS,
      source: toSource(operation.provenance),
    });
  }

  if (operation?.completedAt) {
    events.push({
      id: `${operation.id}-completed`,
      at: operation.completedAt,
      title: "Operación completada",
      description: `${operation.evidenceCount} evidencia(s) asociada(s) a la rotación.`,
      status: OPERATION_STATUS.COMPLETED,
      source: toSource(operation.provenance),
    });
  }

  return events.sort((first, second) => Date.parse(first.at) - Date.parse(second.at));
}

function toIncidents(operation: Operation | undefined): PortalIncident[] {
  if (!operation?.incidentCount) return [];
  return [
    {
      id: `${operation.id}-incident-summary`,
      title: `${operation.incidentCount} incidencia(s) registrada(s)`,
      severity: "Seguimiento requerido",
      status: "Abierta",
      openedAt: operation.startedAt ?? operation.provenance.capturedAt,
      updatedAt: operation.provenance.lastSyncedAt,
      summary:
        "El portal expone el conteo recibido; el detalle permanece en el registro operacional autorizado.",
      source: toSource(operation.provenance),
    },
  ];
}

function toViewFlight(
  flight: DomainFlight,
  operation: Operation | undefined,
  documents: DomainDocument[],
): PortalFlight {
  const updatedAt = operation?.provenance.lastSyncedAt ?? flight.provenance.lastSyncedAt;
  return {
    operationId: operation?.id ?? flight.operationId ?? flight.id,
    flightNumber: flight.flightNumber,
    route: `${flight.origin} → ${flight.destination}`,
    aircraft: flight.aircraftType,
    registration: flight.aircraftRegistration,
    station: flight.station,
    stand: "Por confirmar",
    flightStatus: FLIGHT_STATUS[flight.status],
    operationStatus: operation ? OPERATION_STATUS[operation.status] : "Sin operación",
    scheduledAt: flight.scheduledAt,
    estimatedAt: flight.estimatedAt ?? flight.scheduledAt,
    updatedAt,
    source: toSource(flight.provenance),
    services:
      operation?.services.map((service) => ({
        id: `${operation.id}-${service.code}`,
        name: service.name,
        status: SERVICE_STATUS[service.status],
        sla: `Objetivo operativo ${operation.slaTargetMinutes} min`,
        scheduledAt: operation.startedAt ?? flight.scheduledAt,
        completedAt:
          service.status === "COMPLETED" ? (operation.completedAt ?? undefined) : undefined,
        owner: operation.assignedTeam,
        source: toSource(operation.provenance),
      })) ?? [],
    timeline: toTimeline(flight, operation),
    incidents: toIncidents(operation),
    documents: toDocuments(documents, flight, operation),
  };
}

function kpisFor(repository: MockPortalRepository): PortalKpi[] {
  const kpis = repository.getKpis();
  return [
    {
      id: "flights-today",
      label: "Vuelos de hoy",
      value: kpis.flightsToday,
      detail: `${kpis.operationsInProgress} operación(es) en curso`,
      tone: "neutral",
    },
    {
      id: "on-time",
      label: "Puntualidad",
      value: `${kpis.onTimePerformancePercent}%`,
      detail: "Dentro del margen operacional",
      tone: "positive",
    },
    {
      id: "service-compliance",
      label: "Cumplimiento de servicio",
      value: `${kpis.serviceCompliancePercent}%`,
      detail: `${kpis.operationsCompleted} operación(es) completada(s)`,
      tone: "positive",
    },
    {
      id: "incidents",
      label: "Incidencias abiertas",
      value: kpis.openIncidents,
      detail: `${kpis.unreadNotifications} notificación(es) sin leer`,
      tone: kpis.openIncidents > 0 ? "attention" : "positive",
    },
  ];
}

function overviewFor(
  repository: MockPortalRepository,
  flights: PortalFlight[],
): PortalOverview {
  const activeFlights = flights.filter(
    (flight) => !["Completado", "Cancelado"].includes(flight.flightStatus),
  );
  const notifications = repository.listNotifications().slice(0, 6);

  return {
    kpis: kpisFor(repository),
    activeFlights: (activeFlights.length ? activeFlights : flights).slice(0, 5),
    recentChanges: notifications.map((notification) => ({
      id: notification.id,
      at: notification.createdAt,
      title: notification.title,
      description: notification.message,
      source: "ELEVANT",
    })),
  };
}

function BridgeState({
  kind,
  title,
  description,
  onRetry,
}: {
  kind: "loading" | "error" | "empty";
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.bridgeState} role={kind === "error" ? "alert" : "status"}>
      <span aria-hidden="true">{kind === "error" ? <AlertIcon /> : <PlaneIcon />}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export type PortalDataBridgeProps =
  | { view: "overview" }
  | { view: "flights" }
  | { view: "flightDetail"; operationId: string };

export function PortalDataBridge(props: PortalDataBridgeProps) {
  const { session } = useMockSession();
  const { data, repository, refresh: refreshWorkspace } = usePortalWorkspace();
  const [filters, setFilters] = useState<PortalFlightFilters>({
    query: "",
    status: "",
    station: "",
  });
  const [isRefreshing, startRefresh] = useTransition();

  const result = useMemo(() => {
    if (!data) return { kind: "loading" as const };
    try {
      const domainFlights = data.flights;
      const operations = data.operations;
      const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
      const documents = data.documents;
      const flights = domainFlights.map((flight) =>
        toViewFlight(
          flight,
          flight.operationId ? operationsById.get(flight.operationId) : undefined,
          documents,
        ),
      );
      return { kind: "ready" as const, domainFlights, flights, operationsById, documents };
    } catch (error) {
      return {
        kind: "error" as const,
        message: error instanceof Error ? error.message : "No fue posible consultar el portal.",
      };
    }
  }, [data]);

  const refresh = () => startRefresh(refreshWorkspace);

  if (result.kind === "loading") {
    return (
      <BridgeState
        kind="loading"
        title="Preparando datos operacionales"
        description="Aplicando el alcance autorizado de tu sesión."
      />
    );
  }

  if (result.kind === "error") {
    return (
      <BridgeState
        kind="error"
        title="No pudimos consultar la operación"
        description={result.message}
        onRetry={refresh}
      />
    );
  }

  if (props.view === "overview") {
    return (
      <PortalOverviewView
        overview={overviewFor(repository, result.flights)}
        station={session?.stations.primary}
        onRefresh={refresh}
        isRefreshing={isRefreshing}
      />
    );
  }

  if (props.view === "flights") {
    const query = filters.query.trim().toLocaleLowerCase("es");
    const visibleFlights = result.flights.filter((flight) => {
      const matchesQuery =
        !query ||
        [flight.flightNumber, flight.route, flight.registration, flight.aircraft]
          .join(" ")
          .toLocaleLowerCase("es")
          .includes(query);
      return (
        matchesQuery &&
        (!filters.status || flight.flightStatus === filters.status) &&
        (!filters.station || flight.station === filters.station)
      );
    });

    return (
      <PortalFlightSummaryView
        flights={visibleFlights}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={refresh}
        isRefreshing={isRefreshing}
      />
    );
  }

  let detailResult:
    | { kind: "ready"; flight: PortalFlight }
    | { kind: "error"; message: string };
  try {
    const operation = repository.getOperation(props.operationId);
    const flight = repository.getFlight(operation.flightId);
    detailResult = {
      kind: "ready",
      flight: toViewFlight(flight, operation, result.documents),
    };
  } catch (error) {
    detailResult = {
      kind: "error",
      message:
        error instanceof Error
          ? error.message
          : "La rotación no existe o no está autorizada para esta sesión.",
    };
  }

  if (detailResult.kind === "error") {
    return (
      <BridgeState
        kind="empty"
        title="Rotación no disponible"
        description={detailResult.message}
      />
    );
  }

  return (
    <PortalFlightDetailView
      flight={detailResult.flight}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
    />
  );
}
