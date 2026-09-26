"use client";

import { useMemo, useState } from "react";

import { calculatePortalKpis, createPortalFixtures } from "@/lib/portal";

import type { PortalFlight, PortalFlightFilters, PortalOverview } from "./portal-types";
import { PortalFlightSummaryView, PortalOverviewView } from "./PortalViews";

const DEMO_AIRLINE_ID = "airline_demo";

const FLIGHT_STATUS = {
  SCHEDULED: "Programado",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
} as const;

const OPERATION_STATUS = {
  PLANNED: "Planificada",
  IN_PROGRESS: "En rampa",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
} as const;

function makePreview() {
  const now = new Date();
  const fixtures = createPortalFixtures(now);
  const flights: PortalFlight[] = fixtures.flights
    .filter((flight) => flight.airlineId === DEMO_AIRLINE_ID && flight.station === "PUJ")
    .map((flight) => {
      const operation = fixtures.operations.find(
        (candidate) => candidate.airlineId === DEMO_AIRLINE_ID && candidate.id === flight.operationId,
      );
      return {
        operationId: flight.operationId ?? flight.id,
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
        updatedAt: flight.provenance.lastSyncedAt,
        source: "Ejemplo sintético",
        services: [], timeline: [], incidents: [], documents: [],
      };
    });
  const kpis = calculatePortalKpis(fixtures, {
    airlineId: DEMO_AIRLINE_ID, stations: ["PUJ"], now,
  });
  const overview: PortalOverview = {
    kpis: [
      { id: "today", label: "Vuelos de hoy", value: kpis.flightsToday,
        detail: `${kpis.operationsInProgress} operación(es) en curso` },
      { id: "punctuality", label: "Puntualidad", value: `${kpis.onTimePerformancePercent}%`,
        detail: "Dentro del margen operacional", tone: "positive" },
      { id: "service", label: "Cumplimiento de servicio", value: `${kpis.serviceCompliancePercent}%`,
        detail: `${kpis.operationsCompleted} operación(es) completada(s)`, tone: "positive" },
      { id: "incidents", label: "Incidencias abiertas", value: kpis.openIncidents,
        detail: `${kpis.unreadNotifications} notificación(es) sin leer`, tone: "attention" },
    ],
    activeFlights: flights.filter((flight) => flight.flightStatus !== "Completado"),
    recentChanges: fixtures.notifications
      .filter((notification) => notification.airlineId === DEMO_AIRLINE_ID)
      .map((notification) => ({ id: notification.id, at: notification.createdAt,
        title: notification.title, description: notification.message, source: "Ejemplo sintético" })),
  };
  return { flights, overview };
}

export function PortalDemoPreview({ view }: { view: "overview" | "flights" }) {
  const preview = useMemo(() => makePreview(), []);
  const [filters, setFilters] = useState<PortalFlightFilters>({ query: "", status: "", station: "" });

  if (view === "overview") {
    return <PortalOverviewView overview={preview.overview} station="PUJ" demo />;
  }

  const query = filters.query.trim().toLocaleLowerCase("es");
  const visibleFlights = preview.flights.filter((flight) =>
    (!query || [flight.flightNumber, flight.route, flight.registration].join(" ").toLocaleLowerCase("es").includes(query))
    && (!filters.status || flight.flightStatus === filters.status)
    && (!filters.station || flight.station === filters.station),
  );
  return <PortalFlightSummaryView flights={visibleFlights} filters={filters}
    onFiltersChange={setFilters} demo />;
}
