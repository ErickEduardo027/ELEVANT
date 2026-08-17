import type { MockAirlineSession, MockPermission } from "../mock-auth";

import { PortalDomainError } from "./errors";
import { createPortalFixtures } from "./fixtures";
import { calculatePortalKpis } from "./kpis";
import type {
  Audit,
  BillingCase,
  CreateServiceRequestInput,
  DataProvenance,
  DisputeInput,
  Invoice,
  InvoiceClaimInput,
  Notification,
  Operation,
  PortalDocument,
  PortalFixtureSet,
  PortalFlight,
  PortalKpis,
  PortalListFilters,
  Reconciliation,
  ServiceRequest,
  Contract,
} from "./types";

export interface MockPortalRepositoryOptions {
  now?: () => Date | number;
  idGenerator?: (prefix: string) => string;
  fixtures?: PortalFixtureSet;
  /** Pass null to explicitly disable persistence (for SSR/tests). */
  localStorage?: Storage | null;
}

export const PORTAL_STORAGE_SCHEMA_VERSION = 1 as const;
export const PORTAL_STORAGE_KEY_PREFIX = "elevant.mock-portal.state.v1";

export function portalStorageKey(airlineId: string): string {
  return `${PORTAL_STORAGE_KEY_PREFIX}:${encodeURIComponent(airlineId)}`;
}

interface PersistedPortalState {
  schemaVersion: typeof PORTAL_STORAGE_SCHEMA_VERSION;
  airlineId: string;
  savedAt: string;
  data: PortalFixtureSet;
}

export type ProvenanceEntityType =
  | "flight"
  | "operation"
  | "contract"
  | "document"
  | "invoice"
  | "reconciliation"
  | "serviceRequest"
  | "billingCase";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizedText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new PortalDomainError("INVALID_INPUT", `${label} es obligatorio.`);
  }
  if (normalized.length > maxLength) {
    throw new PortalDomainError(
      "INVALID_INPUT",
      `${label} no puede exceder ${maxLength} caracteres.`,
    );
  }
  return normalized;
}

function parseDate(value: string | Date, label: string): Date {
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new PortalDomainError("INVALID_INPUT", `${label} no es una fecha válida.`);
  }
  return parsed;
}

function normalizeLineIds(lineIds: readonly string[] | undefined): string[] {
  if (!lineIds) return [];
  const normalized = lineIds.map((lineId) => lineId.trim());
  if (normalized.some((lineId) => !lineId)) {
    throw new PortalDomainError(
      "INVALID_INPUT",
      "Los identificadores de línea no pueden estar vacíos.",
    );
  }
  return [...new Set(normalized)];
}

export class MockPortalRepository {
  readonly #session: MockAirlineSession;
  readonly #options: MockPortalRepositoryOptions;
  #data: PortalFixtureSet;
  readonly #initialData: PortalFixtureSet;
  #sequence = 0;

  constructor(
    session: MockAirlineSession,
    options: MockPortalRepositoryOptions = {},
  ) {
    this.#session = clone(session);
    this.#options = options;
    this.#data = clone(options.fixtures ?? createPortalFixtures(this.#now()));
    this.#initialData = clone(this.#data);
    this.#requirePermission("portal:access");
    this.#hydrate();
  }

  #storage(): Storage | null {
    if ("localStorage" in this.#options) {
      return this.#options.localStorage ?? null;
    }
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  }

  #storageKey(): string {
    return portalStorageKey(this.#session.airlineId);
  }

  #tenantData(): PortalFixtureSet {
    const belongsToTenant = (item: { airlineId: string }) =>
      item.airlineId === this.#session.airlineId;
    return {
      flights: clone(this.#data.flights.filter(belongsToTenant)),
      operations: clone(this.#data.operations.filter(belongsToTenant)),
      contracts: clone(this.#data.contracts.filter(belongsToTenant)),
      documents: clone(this.#data.documents.filter(belongsToTenant)),
      invoices: clone(this.#data.invoices.filter(belongsToTenant)),
      reconciliations: clone(
        this.#data.reconciliations.filter(belongsToTenant),
      ),
      serviceRequests: clone(
        this.#data.serviceRequests.filter(belongsToTenant),
      ),
      billingCases: clone(this.#data.billingCases.filter(belongsToTenant)),
      notifications: clone(this.#data.notifications.filter(belongsToTenant)),
      audits: clone(this.#data.audits.filter(belongsToTenant)),
    };
  }

  #isPersistedState(value: unknown): value is PersistedPortalState {
    if (!value || typeof value !== "object") return false;
    const state = value as Partial<PersistedPortalState>;
    if (
      state.schemaVersion !== PORTAL_STORAGE_SCHEMA_VERSION ||
      state.airlineId !== this.#session.airlineId ||
      typeof state.savedAt !== "string" ||
      !state.data ||
      typeof state.data !== "object"
    ) {
      return false;
    }
    const collections = [
      state.data.flights,
      state.data.operations,
      state.data.contracts,
      state.data.documents,
      state.data.invoices,
      state.data.reconciliations,
      state.data.serviceRequests,
      state.data.billingCases,
      state.data.notifications,
      state.data.audits,
    ];
    return (
      collections.every(Array.isArray) &&
      collections.every((items) =>
        items.every(
          (item) =>
            Boolean(item) &&
            typeof item === "object" &&
            "airlineId" in item &&
            item.airlineId === this.#session.airlineId,
        ),
      )
    );
  }

  #hydrate(): void {
    const storage = this.#storage();
    if (!storage) return;
    try {
      const raw = storage.getItem(this.#storageKey());
      if (!raw) return;
      const state = JSON.parse(raw) as unknown;
      if (!this.#isPersistedState(state)) {
        throw new Error("Invalid persisted portal state");
      }
      const foreign = <T extends { airlineId: string }>(items: T[]) =>
        items.filter((item) => item.airlineId !== this.#session.airlineId);
      this.#data.flights = [...foreign(this.#data.flights), ...clone(state.data.flights)];
      this.#data.operations = [...foreign(this.#data.operations), ...clone(state.data.operations)];
      this.#data.contracts = [...foreign(this.#data.contracts), ...clone(state.data.contracts)];
      this.#data.documents = [...foreign(this.#data.documents), ...clone(state.data.documents)];
      this.#data.invoices = [...foreign(this.#data.invoices), ...clone(state.data.invoices)];
      this.#data.reconciliations = [
        ...foreign(this.#data.reconciliations),
        ...clone(state.data.reconciliations),
      ];
      this.#data.serviceRequests = [
        ...foreign(this.#data.serviceRequests),
        ...clone(state.data.serviceRequests),
      ];
      this.#data.billingCases = [
        ...foreign(this.#data.billingCases),
        ...clone(state.data.billingCases),
      ];
      this.#data.notifications = [
        ...foreign(this.#data.notifications),
        ...clone(state.data.notifications),
      ];
      this.#data.audits = [...foreign(this.#data.audits), ...clone(state.data.audits)];
    } catch {
      try {
        storage.removeItem(this.#storageKey());
      } catch {
        // Persistence is best-effort in restricted browser modes.
      }
    }
  }

  #persist(): void {
    const storage = this.#storage();
    if (!storage) return;
    const state: PersistedPortalState = {
      schemaVersion: PORTAL_STORAGE_SCHEMA_VERSION,
      airlineId: this.#session.airlineId,
      savedAt: this.#now().toISOString(),
      data: this.#tenantData(),
    };
    try {
      storage.setItem(this.#storageKey(), JSON.stringify(state));
    } catch {
      // The mock remains usable if storage is full or unavailable.
    }
  }

  #now(): Date {
    const value = this.#options.now?.() ?? Date.now();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new TypeError("El reloj del portal debe producir una fecha válida.");
    }
    return date;
  }

  #nextId(prefix: string): string {
    if (this.#options.idGenerator) return this.#options.idGenerator(prefix);
    this.#sequence += 1;
    return `${prefix}_${this.#now().getTime().toString(36)}_${this.#sequence}`;
  }

  #hasPermission(permission: MockPermission): boolean {
    return this.#session.permissions.includes(permission);
  }

  #requirePermission(permission: MockPermission): void {
    if (!this.#hasPermission(permission)) {
      throw new PortalDomainError(
        "FORBIDDEN",
        `La sesión no tiene el permiso ${permission}.`,
      );
    }
  }

  #hasStation(station: string): boolean {
    return this.#session.stations.authorized.includes(station.toUpperCase());
  }

  #requireStation(station: string): string {
    const normalized = station.trim().toUpperCase();
    if (!normalized || !this.#hasStation(normalized)) {
      throw new PortalDomainError("FORBIDDEN", "La estación no está autorizada.");
    }
    return normalized;
  }

  #scope<T extends { airlineId: string }>(items: readonly T[]): T[] {
    return items.filter((item) => item.airlineId === this.#session.airlineId);
  }

  #stationScope<T extends { airlineId: string; station: string }>(
    items: readonly T[],
  ): T[] {
    return this.#scope(items).filter((item) => this.#hasStation(item.station));
  }

  #findTenant<T extends { id: string; airlineId: string }>(
    items: readonly T[],
    id: string,
  ): T {
    const value = items.find(
      (item) => item.id === id && item.airlineId === this.#session.airlineId,
    );
    if (!value) {
      throw new PortalDomainError("NOT_FOUND", "El recurso no existe.");
    }
    return value;
  }

  #findStation<T extends { id: string; airlineId: string; station: string }>(
    items: readonly T[],
    id: string,
  ): T {
    const value = items.find(
      (item) =>
        item.id === id &&
        item.airlineId === this.#session.airlineId &&
        this.#hasStation(item.station),
    );
    if (!value) {
      throw new PortalDomainError("NOT_FOUND", "El recurso no existe.");
    }
    return value;
  }

  #filterDates<T>(
    items: T[],
    filters: PortalListFilters,
    selectDate: (item: T) => string,
  ): T[] {
    const from = filters.from ? parseDate(filters.from, "La fecha inicial") : null;
    const to = filters.to ? parseDate(filters.to, "La fecha final") : null;
    if (from && to && from > to) {
      throw new PortalDomainError(
        "INVALID_INPUT",
        "La fecha inicial no puede ser posterior a la fecha final.",
      );
    }
    return items.filter((item) => {
      const timestamp = Date.parse(selectDate(item));
      return (!from || timestamp >= from.getTime()) && (!to || timestamp <= to.getTime());
    });
  }

  #audit(
    action: string,
    entityType: Audit["entityType"],
    entityId: string,
    details: Audit["details"] = {},
  ): Audit {
    const audit: Audit = {
      id: this.#nextId("aud"),
      airlineId: this.#session.airlineId,
      actorId: this.#session.userId,
      actorName: this.#session.user.fullName,
      action,
      entityType,
      entityId,
      occurredAt: this.#now().toISOString(),
      details,
    };
    this.#data.audits.unshift(audit);
    return audit;
  }

  #notify(
    category: Notification["category"],
    title: string,
    message: string,
    href: string | null,
  ): void {
    this.#data.notifications.unshift({
      id: this.#nextId("not"),
      airlineId: this.#session.airlineId,
      category,
      title,
      message,
      createdAt: this.#now().toISOString(),
      readAt: null,
      href,
    });
  }

  getKpis(): PortalKpis {
    this.#requirePermission("operations:read");
    return calculatePortalKpis(this.#data, {
      airlineId: this.#session.airlineId,
      stations: this.#session.stations.authorized,
      now: this.#now(),
    });
  }

  listFlights(filters: PortalListFilters = {}): PortalFlight[] {
    this.#requirePermission("flights:read");
    const station = filters.station
      ? this.#requireStation(filters.station)
      : null;
    const scoped = this.#stationScope(this.#data.flights).filter(
      (flight) => !station || flight.station === station,
    );
    return clone(
      this.#filterDates(scoped, filters, (flight) => flight.scheduledAt).sort(
        (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
      ),
    );
  }

  getFlight(id: string): PortalFlight {
    const flight = this.#findStation(this.#data.flights, id);
    this.#requirePermission("flights:read");
    return clone(flight);
  }

  listOperations(filters: PortalListFilters = {}): Operation[] {
    this.#requirePermission("operations:read");
    const station = filters.station
      ? this.#requireStation(filters.station)
      : null;
    let operations = this.#stationScope(this.#data.operations).filter(
      (operation) => !station || operation.station === station,
    );
    if (filters.from || filters.to) {
      const flightById = new Map(
        this.#data.flights.map((flight) => [flight.id, flight]),
      );
      operations = this.#filterDates(
        operations,
        filters,
        (operation) =>
          flightById.get(operation.flightId)?.scheduledAt ??
          operation.provenance.capturedAt,
      );
    }
    return clone(operations);
  }

  getOperation(id: string): Operation {
    const operation = this.#findStation(this.#data.operations, id);
    this.#requirePermission("operations:read");
    return clone(operation);
  }

  listContracts(): Contract[] {
    this.#requirePermission("contracts:read");
    return clone(
      this.#scope(this.#data.contracts).filter((contract) =>
        contract.stations.some((station) => this.#hasStation(station)),
      ),
    );
  }

  getContract(id: string): Contract {
    const contract = this.#findTenant(this.#data.contracts, id);
    if (!contract.stations.some((station) => this.#hasStation(station))) {
      throw new PortalDomainError("NOT_FOUND", "El recurso no existe.");
    }
    this.#requirePermission("contracts:read");
    return clone(contract);
  }

  listDocuments(filters: PortalListFilters = {}): PortalDocument[] {
    const station = filters.station
      ? this.#requireStation(filters.station)
      : null;
    const documents = this.#stationScope(this.#data.documents).filter(
      (document) =>
        (!station || document.station === station) &&
        document.status !== "REVOKED" &&
        this.#hasPermission(document.requiredPermission),
    );
    return clone(
      this.#filterDates(documents, filters, (document) => document.createdAt).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    );
  }

  getAuthorizedDocument(id: string): PortalDocument {
    const document = this.#findStation(this.#data.documents, id);
    this.#requirePermission(document.requiredPermission);
    if (document.status !== "AVAILABLE" || !document.downloadUrl) {
      throw new PortalDomainError(
        "INVALID_STATE",
        "El documento aún no está disponible.",
      );
    }
    return clone(document);
  }

  listInvoices(): Invoice[] {
    this.#requirePermission("billing:read");
    return clone(
      this.#scope(this.#data.invoices).sort(
        (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt),
      ),
    );
  }

  getInvoice(id: string): Invoice {
    const invoice = this.#findTenant(this.#data.invoices, id);
    this.#requirePermission("billing:read");
    return clone(invoice);
  }

  listReconciliations(filters: PortalListFilters = {}): Reconciliation[] {
    this.#requirePermission("billing:read");
    const station = filters.station
      ? this.#requireStation(filters.station)
      : null;
    return clone(
      this.#stationScope(this.#data.reconciliations).filter(
        (item) => !station || item.station === station,
      ),
    );
  }

  getReconciliation(id: string): Reconciliation {
    const reconciliation = this.#findStation(this.#data.reconciliations, id);
    this.#requirePermission("billing:read");
    return clone(reconciliation);
  }

  listServiceRequests(filters: PortalListFilters = {}): ServiceRequest[] {
    this.#requirePermission("service-requests:read");
    const station = filters.station
      ? this.#requireStation(filters.station)
      : null;
    const values = this.#stationScope(this.#data.serviceRequests).filter(
      (request) => !station || request.station === station,
    );
    return clone(
      this.#filterDates(values, filters, (request) => request.requestedFor).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    );
  }

  getServiceRequest(id: string): ServiceRequest {
    const request = this.#findStation(this.#data.serviceRequests, id);
    this.#requirePermission("service-requests:read");
    return clone(request);
  }

  listBillingCases(): BillingCase[] {
    this.#requirePermission("billing:read");
    return clone(
      this.#scope(this.#data.billingCases).sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      ),
    );
  }

  getBillingCase(id: string): BillingCase {
    const billingCase = this.#findTenant(this.#data.billingCases, id);
    this.#requirePermission("billing:read");
    return clone(billingCase);
  }

  listNotifications(options: { unreadOnly?: boolean } = {}): Notification[] {
    this.#requirePermission("notifications:read");
    const values = this.#scope(this.#data.notifications).filter(
      (notification) => !options.unreadOnly || notification.readAt === null,
    );
    return clone(
      values.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    );
  }

  listAudit(): Audit[] {
    this.#requirePermission("portal:access");
    return clone(
      this.#scope(this.#data.audits).sort(
        (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
      ),
    );
  }

  getDataProvenance(
    entityType: ProvenanceEntityType,
    id: string,
  ): DataProvenance {
    const lookups: Record<
      ProvenanceEntityType,
      () => { provenance: DataProvenance }
    > = {
      flight: () => this.getFlight(id),
      operation: () => this.getOperation(id),
      contract: () => this.getContract(id),
      document: () => {
        const document = this.#findStation(this.#data.documents, id);
        this.#requirePermission(document.requiredPermission);
        return document;
      },
      invoice: () => this.getInvoice(id),
      reconciliation: () => this.getReconciliation(id),
      serviceRequest: () => this.getServiceRequest(id),
      billingCase: () => this.getBillingCase(id),
    };
    return clone(lookups[entityType]().provenance);
  }

  resetMockState(): void {
    this.#data = clone(this.#initialData);
    try {
      this.#storage()?.removeItem(this.#storageKey());
    } catch {
      // The in-memory reset still succeeds when browser storage is restricted.
    }
  }

  createServiceRequest(input: CreateServiceRequestInput): ServiceRequest {
    this.#requirePermission("service-requests:create");
    const station = this.#requireStation(input.station);
    const requestedFor = parseDate(input.requestedFor, "La fecha solicitada");
    if (requestedFor.getTime() < this.#now().getTime()) {
      throw new PortalDomainError(
        "INVALID_INPUT",
        "La fecha solicitada no puede estar en el pasado.",
      );
    }
    if (input.flightId) {
      const flight = this.#findStation(this.#data.flights, input.flightId);
      if (flight.station !== station) {
        throw new PortalDomainError(
          "INVALID_INPUT",
          "El vuelo no pertenece a la estación solicitada.",
        );
      }
    }
    const now = this.#now().toISOString();
    const id = this.#nextId("req");
    const request: ServiceRequest = {
      id,
      airlineId: this.#session.airlineId,
      station,
      flightId: input.flightId ?? null,
      requestedBy: this.#session.userId,
      type: input.type,
      title: normalizedText(input.title, "El título", 120),
      description: normalizedText(input.description, "La descripción", 1_000),
      requestedFor: requestedFor.toISOString(),
      status: "SUBMITTED",
      createdAt: now,
      updatedAt: now,
      cancellationReason: null,
      provenance: {
        source: "AIRLINE_PORTAL",
        sourceRecordId: id,
        capturedAt: now,
        lastSyncedAt: now,
        quality: "REPORTED",
      },
    };
    this.#data.serviceRequests.unshift(request);
    this.#audit("service_request.created", "SERVICE_REQUEST", id, { station });
    this.#notify(
      "REQUEST",
      "Solicitud registrada",
      `La solicitud “${request.title}” fue registrada.`,
      "/portal/solicitudes",
    );
    this.#persist();
    return clone(request);
  }

  cancelServiceRequest(id: string, reason: string): ServiceRequest {
    const request = this.#findStation(this.#data.serviceRequests, id);
    this.#requirePermission("service-requests:cancel");
    if (request.status !== "SUBMITTED") {
      throw new PortalDomainError(
        "INVALID_STATE",
        "La solicitud ya no puede cancelarse.",
      );
    }
    request.status = "CANCELLED";
    request.cancellationReason = normalizedText(
      reason,
      "El motivo de cancelación",
      500,
    );
    request.updatedAt = this.#now().toISOString();
    request.provenance.lastSyncedAt = request.updatedAt;
    this.#audit("service_request.cancelled", "SERVICE_REQUEST", id, {
      reason: request.cancellationReason,
    });
    this.#persist();
    return clone(request);
  }

  acceptPrebill(id: string, note = "Aceptada por la aerolínea."): Invoice {
    const invoice = this.#findTenant(this.#data.invoices, id);
    this.#requirePermission("billing:respond");
    if (invoice.kind !== "PREBILL" || invoice.status !== "PENDING_REVIEW") {
      throw new PortalDomainError(
        "INVALID_STATE",
        "La prefactura no está pendiente de revisión.",
      );
    }
    invoice.status = "ACCEPTED";
    invoice.respondedAt = this.#now().toISOString();
    invoice.responseNote = normalizedText(note, "La nota", 1_000);
    invoice.provenance.lastSyncedAt = invoice.respondedAt;
    this.#audit("prebill.accepted", "INVOICE", id, {});
    this.#notify(
      "BILLING",
      "Prefactura aceptada",
      `La prefactura ${invoice.invoiceNumber} fue aceptada.`,
      "/portal/finanzas",
    );
    this.#persist();
    return clone(invoice);
  }

  disputePrebill(id: string, input: DisputeInput): BillingCase {
    const invoice = this.#findTenant(this.#data.invoices, id);
    this.#requirePermission("billing:respond");
    if (invoice.kind !== "PREBILL" || invoice.status !== "PENDING_REVIEW") {
      throw new PortalDomainError(
        "INVALID_STATE",
        "La prefactura no está pendiente de revisión.",
      );
    }
    const reason = normalizedText(input.reason, "El motivo", 1_000);
    const lineIds = normalizeLineIds(input.lineIds);
    if (
      lineIds.some(
        (lineId) => !invoice.lines.some((line) => line.id === lineId),
      )
    ) {
      throw new PortalDomainError(
        "INVALID_INPUT",
        "Una o más líneas disputadas no pertenecen a la prefactura.",
      );
    }
    invoice.status = "DISPUTED";
    invoice.respondedAt = this.#now().toISOString();
    invoice.responseNote = reason;
    invoice.provenance.lastSyncedAt = invoice.respondedAt;
    const billingCase = this.#createBillingCase({
      invoiceId: invoice.id,
      reconciliationId: null,
      type: "PREBILL_DISPUTE",
      subject: input.subject ?? `Disputa de ${invoice.invoiceNumber}`,
      description: reason,
      lineIds,
    });
    this.#audit("prebill.disputed", "INVOICE", id, {
      billingCaseId: billingCase.id,
      lineIds,
    });
    this.#persist();
    return clone(billingCase);
  }

  acceptReconciliation(
    id: string,
    note = "Conciliación aceptada por la aerolínea.",
  ): Reconciliation {
    const reconciliation = this.#findStation(this.#data.reconciliations, id);
    this.#requirePermission("billing:respond");
    if (!["PENDING_REVIEW", "MATCHED"].includes(reconciliation.status)) {
      throw new PortalDomainError(
        "INVALID_STATE",
        "La conciliación ya fue respondida.",
      );
    }
    reconciliation.status = "ACCEPTED";
    reconciliation.respondedAt = this.#now().toISOString();
    reconciliation.responseNote = normalizedText(note, "La nota", 1_000);
    reconciliation.provenance.lastSyncedAt = reconciliation.respondedAt;
    this.#audit("reconciliation.accepted", "RECONCILIATION", id, {});
    this.#persist();
    return clone(reconciliation);
  }

  disputeReconciliation(id: string, input: DisputeInput): BillingCase {
    const reconciliation = this.#findStation(this.#data.reconciliations, id);
    this.#requirePermission("billing:respond");
    if (!["PENDING_REVIEW", "MATCHED"].includes(reconciliation.status)) {
      throw new PortalDomainError(
        "INVALID_STATE",
        "La conciliación ya fue respondida.",
      );
    }
    const reason = normalizedText(input.reason, "El motivo", 1_000);
    const lineIds = normalizeLineIds(input.lineIds);
    reconciliation.status = "DISPUTED";
    reconciliation.respondedAt = this.#now().toISOString();
    reconciliation.responseNote = reason;
    reconciliation.provenance.lastSyncedAt = reconciliation.respondedAt;
    const billingCase = this.#createBillingCase({
      invoiceId: null,
      reconciliationId: reconciliation.id,
      type: "RECONCILIATION_DISPUTE",
      subject: input.subject ?? "Disputa de conciliación",
      description: reason,
      lineIds,
    });
    this.#audit("reconciliation.disputed", "RECONCILIATION", id, {
      billingCaseId: billingCase.id,
      lineIds,
    });
    this.#persist();
    return clone(billingCase);
  }

  claimInvoice(id: string, input: InvoiceClaimInput): BillingCase {
    const invoice = this.#findTenant(this.#data.invoices, id);
    this.#requirePermission("billing:respond");
    if (invoice.kind !== "INVOICE" || !["ISSUED", "OVERDUE"].includes(invoice.status)) {
      throw new PortalDomainError(
        "INVALID_STATE",
        "La factura no admite reclamos en su estado actual.",
      );
    }
    if (
      this.#data.billingCases.some(
        (item) =>
          item.airlineId === this.#session.airlineId &&
          item.invoiceId === id &&
          item.type === "INVOICE_CLAIM" &&
          !["RESOLVED", "CLOSED"].includes(item.status),
      )
    ) {
      throw new PortalDomainError(
        "CONFLICT",
        "La factura ya tiene un reclamo abierto.",
      );
    }
    const billingCase = this.#createBillingCase({
      invoiceId: id,
      reconciliationId: null,
      type: "INVOICE_CLAIM",
      subject: input.subject,
      description: input.description,
      lineIds: [],
    });
    this.#audit("invoice.claimed", "INVOICE", id, {
      billingCaseId: billingCase.id,
    });
    this.#persist();
    return clone(billingCase);
  }

  #createBillingCase(input: {
    invoiceId: string | null;
    reconciliationId: string | null;
    type: BillingCase["type"];
    subject: string;
    description: string;
    lineIds: string[];
  }): BillingCase {
    const now = this.#now().toISOString();
    const id = this.#nextId("case");
    const billingCase: BillingCase = {
      id,
      airlineId: this.#session.airlineId,
      invoiceId: input.invoiceId,
      reconciliationId: input.reconciliationId,
      type: input.type,
      subject: normalizedText(input.subject, "El asunto", 160),
      description: normalizedText(input.description, "La descripción", 1_000),
      lineIds: clone(input.lineIds),
      status: "OPEN",
      createdBy: this.#session.userId,
      createdAt: now,
      updatedAt: now,
      resolution: null,
      provenance: {
        source: "AIRLINE_PORTAL",
        sourceRecordId: id,
        capturedAt: now,
        lastSyncedAt: now,
        quality: "REPORTED",
      },
    };
    this.#data.billingCases.unshift(billingCase);
    this.#audit("billing_case.created", "BILLING_CASE", id, {
      type: input.type,
    });
    this.#notify(
      "BILLING",
      "Caso de facturación creado",
      `El caso “${billingCase.subject}” fue registrado.`,
      "/portal/finanzas",
    );
    return billingCase;
  }

  markNotificationRead(id: string): Notification {
    const notification = this.#findTenant(this.#data.notifications, id);
    this.#requirePermission("notifications:read");
    if (notification.readAt === null) {
      notification.readAt = this.#now().toISOString();
      this.#audit("notification.read", "NOTIFICATION", id, {});
      this.#persist();
    }
    return clone(notification);
  }

  markAllNotificationsRead(): number {
    this.#requirePermission("notifications:read");
    const unread = this.#scope(this.#data.notifications).filter(
      (notification) => notification.readAt === null,
    );
    const readAt = this.#now().toISOString();
    for (const notification of unread) notification.readAt = readAt;
    if (unread.length > 0) {
      this.#audit("notification.read_all", "NOTIFICATION", this.#session.airlineId, {
        count: unread.length,
      });
      this.#persist();
    }
    return unread.length;
  }

  recordDocumentDownload(id: string): Audit {
    const document = this.getAuthorizedDocument(id);
    const audit = this.#audit("document.downloaded", "DOCUMENT", id, {
      name: document.name,
      station: document.station,
    });
    this.#persist();
    return clone(audit);
  }
}

export const PortalMockRepository = MockPortalRepository;

export function createMockPortalRepository(
  session: MockAirlineSession,
  options?: MockPortalRepositoryOptions,
): MockPortalRepository {
  return new MockPortalRepository(session, options);
}
