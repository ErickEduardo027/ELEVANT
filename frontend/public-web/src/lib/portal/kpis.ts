import type { PortalFixtureSet, PortalKpis } from "./types";

export interface PortalKpiScope {
  airlineId: string;
  stations: readonly string[];
  now?: Date | string | number;
}

function safePercent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

export function calculatePortalKpis(
  data: Readonly<PortalFixtureSet>,
  scope: PortalKpiScope,
): PortalKpis {
  const clock = new Date(scope.now ?? Date.now());
  if (!Number.isFinite(clock.getTime())) {
    throw new TypeError("El reloj del portal debe producir una fecha válida.");
  }
  const today = clock.toISOString().slice(0, 10);
  const stations = new Set(scope.stations);
  const inScope = <T extends { airlineId: string }>(item: T) =>
    item.airlineId === scope.airlineId;
  const inStationScope = <T extends { airlineId: string; station: string }>(
    item: T,
  ) => inScope(item) && stations.has(item.station);

  const flightsToday = data.flights.filter(
    (flight) => inStationScope(flight) && flight.operationDate === today,
  );
  const flightIds = new Set(flightsToday.map((flight) => flight.id));
  const operationsToday = data.operations.filter(
    (operation) =>
      inStationScope(operation) && flightIds.has(operation.flightId),
  );
  const completedFlights = flightsToday.filter(
    (flight) => flight.status === "COMPLETED" && flight.actualAt,
  );
  const onTimeFlights = completedFlights.filter(
    (flight) =>
      Date.parse(flight.actualAt as string) - Date.parse(flight.scheduledAt) <=
      15 * 60_000,
  );
  const concludedServices = operationsToday.flatMap((operation) =>
    operation.services.filter((service) =>
      ["COMPLETED", "NOT_EXECUTED"].includes(service.status),
    ),
  );
  const contractedQuantity = concludedServices.reduce(
    (total, service) => total + service.contractedQuantity,
    0,
  );
  const compliantQuantity = concludedServices.reduce(
    (total, service) =>
      total + Math.min(service.executedQuantity, service.contractedQuantity),
    0,
  );

  return {
    flightsToday: flightsToday.length,
    operationsInProgress: operationsToday.filter(
      (operation) => operation.status === "IN_PROGRESS",
    ).length,
    operationsCompleted: operationsToday.filter(
      (operation) => operation.status === "COMPLETED",
    ).length,
    onTimePerformancePercent: safePercent(
      onTimeFlights.length,
      completedFlights.length,
    ),
    serviceCompliancePercent: safePercent(
      compliantQuantity,
      contractedQuantity,
    ),
    openIncidents: operationsToday.reduce(
      (total, operation) => total + operation.incidentCount,
      0,
    ),
    pendingBillingReviews:
      data.invoices.filter(
        (invoice) =>
          inScope(invoice) && invoice.status === "PENDING_REVIEW",
      ).length +
      data.reconciliations.filter(
        (reconciliation) =>
          inStationScope(reconciliation) &&
          reconciliation.status === "PENDING_REVIEW",
      ).length,
    unreadNotifications: data.notifications.filter(
      (notification) => inScope(notification) && notification.readAt === null,
    ).length,
  };
}
