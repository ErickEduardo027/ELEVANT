import { describe, expect, it } from "vitest";

import {
  MOCK_AIRLINE_PERMISSIONS,
  MOCK_SESSION_SCHEMA_VERSION,
  type MockAirlineSession,
  type MockPermission,
} from "@/lib/mock-auth";
import {
  MockPortalRepository,
  PORTAL_STORAGE_SCHEMA_VERSION,
  PortalDomainError,
  calculatePortalKpis,
  createPortalFixtures,
  isPortalDomainError,
  portalStorageKey,
} from "@/lib/portal";

const NOW = new Date("2026-08-09T16:00:00.000Z");

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  setItem(key: string, value: string) {
    this.#values.set(key, String(value));
  }
}

function createSession(
  overrides: {
    airlineId?: string;
    stations?: string[];
    permissions?: MockPermission[];
  } = {},
): MockAirlineSession {
  const stations = overrides.stations ?? ["PUJ", "SDQ", "STI"];
  return {
    schemaVersion: MOCK_SESSION_SCHEMA_VERSION,
    sessionId: "ses_test",
    userId: "user_demo_operations",
    airlineId: overrides.airlineId ?? "airline_demo",
    role: "AIRLINE_ADMIN",
    user: {
      fullName: "María Rodríguez",
      email: "operaciones@demo.elevant.test",
      title: "Gerente de Operaciones",
    },
    airline: {
      legalName: "ELEVANT Demo Airlines, S.A.",
      displayName: "ELEVANT Demo Airlines",
      iataCode: "EV",
      icaoCode: "ELV",
      country: "República Dominicana",
    },
    stations: { primary: stations[0] ?? "PUJ", authorized: stations },
    permissions: overrides.permissions ?? [...MOCK_AIRLINE_PERMISSIONS],
    source: "demo",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
  };
}

function createRepository(
  session = createSession(),
): MockPortalRepository {
  let sequence = 0;
  return new MockPortalRepository(session, {
    now: () => NOW,
    idGenerator: (prefix) => `${prefix}_test_${++sequence}`,
    localStorage: null,
  });
}

function expectPortalError(
  run: () => unknown,
  code: PortalDomainError["code"],
) {
  expect(run).toThrow(PortalDomainError);
  try {
    run();
  } catch (error) {
    expect(isPortalDomainError(error, code)).toBe(true);
  }
}

describe("portal fixtures and KPI calculations", () => {
  it("anchors every operational fixture to the supplied clock", () => {
    const morning = createPortalFixtures("2026-01-15T08:30:00.000Z");
    const evening = createPortalFixtures("2026-01-16T20:30:00.000Z");

    expect(morning.flights[0].operationDate).toBe("2026-01-15");
    expect(evening.flights[0].operationDate).toBe("2026-01-16");
    expect(
      Date.parse(evening.flights[0].scheduledAt) -
        Date.parse(morning.flights[0].scheduledAt),
    ).toBe(36 * 60 * 60_000);
    expect(morning.flights.every((flight) => flight.station === "PUJ")).toBe(
      true,
    );
  });

  it("calculates tenant and station scoped operational and billing KPIs", () => {
    const fixtures = createPortalFixtures(NOW);

    expect(
      calculatePortalKpis(fixtures, {
        airlineId: "airline_demo",
        stations: ["PUJ"],
        now: NOW,
      }),
    ).toEqual({
      flightsToday: 3,
      operationsInProgress: 1,
      operationsCompleted: 1,
      onTimePerformancePercent: 100,
      serviceCompliancePercent: 100,
      openIncidents: 1,
      pendingBillingReviews: 2,
      unreadNotifications: 2,
    });

    expect(
      calculatePortalKpis(fixtures, {
        airlineId: "airline_other",
        stations: ["PUJ"],
        now: NOW,
      }),
    ).toMatchObject({
      flightsToday: 1,
      pendingBillingReviews: 1,
      unreadNotifications: 1,
    });
  });
});

describe("MockPortalRepository reads and isolation", () => {
  it("returns only the session tenant and authorized stations", () => {
    const repository = createRepository();

    expect(repository.listFlights()).toHaveLength(4);
    expect(repository.listOperations()).toHaveLength(4);
    expect(repository.listContracts()).toHaveLength(1);
    expect(repository.listInvoices()).toHaveLength(2);
    expect(repository.listReconciliations()).toHaveLength(2);
    expect(repository.listServiceRequests()).toHaveLength(1);
    expect(repository.listNotifications()).toHaveLength(3);
    expect(repository.listAudit()).toHaveLength(1);
    expect(repository.getKpis().flightsToday).toBe(3);
  });

  it("treats foreign tenant and unauthorized-station identifiers as not found", () => {
    const repository = createRepository();
    const noPujRepository = createRepository(
      createSession({ stations: ["SDQ"] }),
    );

    expectPortalError(
      () => repository.getFlight("flt_other_secret"),
      "NOT_FOUND",
    );
    expectPortalError(
      () => repository.getOperation("op_other_secret"),
      "NOT_FOUND",
    );
    expectPortalError(
      () => repository.getContract("ctr_other_secret"),
      "NOT_FOUND",
    );
    expectPortalError(
      () => repository.getInvoice("inv_other_secret"),
      "NOT_FOUND",
    );
    expectPortalError(
      () => repository.getReconciliation("rec_other_secret"),
      "NOT_FOUND",
    );
    expectPortalError(
      () => repository.getAuthorizedDocument("doc_other_secret"),
      "NOT_FOUND",
    );
    expectPortalError(
      () => noPujRepository.getFlight("flt_demo_active"),
      "NOT_FOUND",
    );
    expect(noPujRepository.listFlights()).toEqual([]);
  });

  it("enforces read permissions without leaking a foreign entity", () => {
    const repository = createRepository(
      createSession({ permissions: ["portal:access"] }),
    );

    expectPortalError(() => repository.listFlights(), "FORBIDDEN");
    expectPortalError(() => repository.getFlight("flt_demo_active"), "FORBIDDEN");
    expectPortalError(
      () => repository.getFlight("flt_other_secret"),
      "NOT_FOUND",
    );
  });

  it("returns defensive copies and supports station/date filters", () => {
    const repository = createRepository();
    const flights = repository.listFlights();
    flights[0].flightNumber = "MUTATED";
    flights[0].provenance.quality = "ESTIMATED";

    expect(repository.getFlight(flights[0].id).flightNumber).not.toBe("MUTATED");
    expect(repository.getFlight(flights[0].id).provenance.quality).toBe(
      "VERIFIED",
    );
    expect(
      repository.listFlights({
        station: "puj",
        from: "2026-08-09T16:00:00.000Z",
      }),
    ).toHaveLength(2);
    expectPortalError(
      () => repository.listFlights({ station: "LRM" }),
      "FORBIDDEN",
    );
    expectPortalError(
      () =>
        repository.listFlights({
          from: "2026-08-10T00:00:00Z",
          to: "2026-08-09T00:00:00Z",
        }),
      "INVALID_INPUT",
    );
  });

  it("exposes only authorized, available documents and provenance", () => {
    const repository = createRepository();
    const limitedRepository = createRepository(
      createSession({
        permissions: ["portal:access", "documents:read"],
      }),
    );

    expect(repository.listDocuments()).toHaveLength(3);
    expect(limitedRepository.listDocuments().map((item) => item.id)).toEqual([
      "doc_demo_processing",
      "doc_demo_report",
    ]);
    expect(repository.getAuthorizedDocument("doc_demo_report").downloadUrl).toBe(
      "/mock-documents/reporte-operativo-ev-204.pdf",
    );
    expectPortalError(
      () => repository.getAuthorizedDocument("doc_demo_processing"),
      "INVALID_STATE",
    );
    expectPortalError(
      () => limitedRepository.getAuthorizedDocument("doc_demo_evidence"),
      "FORBIDDEN",
    );
    expect(
      repository.getDataProvenance("operation", "op_demo_completed"),
    ).toMatchObject({
      source: "ELEVANT_CORE",
      sourceRecordId: "core-operation-completed",
      quality: "VERIFIED",
    });
  });
});

describe("service request commands", () => {
  it("creates, normalizes, audits, notifies and then cancels a request", () => {
    const repository = createRepository();
    const beforeNotifications = repository.listNotifications().length;
    const request = repository.createServiceRequest({
      station: " puj ",
      flightId: "flt_demo_scheduled",
      type: "SPECIAL_ASSISTANCE",
      title: "  Silla   de ruedas  ",
      description: "  Asistencia en puerta.  ",
      requestedFor: "2026-08-09T21:00:00.000Z",
    });

    expect(request).toMatchObject({
      airlineId: "airline_demo",
      station: "PUJ",
      title: "Silla de ruedas",
      description: "Asistencia en puerta.",
      status: "SUBMITTED",
      requestedBy: "user_demo_operations",
    });
    expect(repository.getServiceRequest(request.id)).toEqual(request);
    expect(repository.listNotifications()).toHaveLength(beforeNotifications + 1);
    expect(repository.listAudit()[0]).toMatchObject({
      action: "service_request.created",
      entityId: request.id,
    });

    const cancelled = repository.cancelServiceRequest(
      request.id,
      "  Ya no es necesaria.  ",
    );
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "Ya no es necesaria.",
    });
    expectPortalError(
      () => repository.cancelServiceRequest(request.id, "Otra vez"),
      "INVALID_STATE",
    );
  });

  it("allows cancellation only while a request is SUBMITTED", () => {
    const fixtures = createPortalFixtures(NOW);
    fixtures.serviceRequests[0].status = "IN_REVIEW";
    const repository = new MockPortalRepository(createSession(), {
      fixtures,
      now: () => NOW,
      localStorage: null,
    });

    expectPortalError(
      () =>
        repository.cancelServiceRequest(
          "req_demo_submitted",
          "Ya no es necesaria.",
        ),
      "INVALID_STATE",
    );
  });

  it("rejects unauthorized stations, foreign flights, past dates and missing permission", () => {
    const repository = createRepository();
    const withoutCreate = createRepository(
      createSession({
        permissions: ["portal:access", "service-requests:read"],
      }),
    );
    const base = {
      station: "PUJ",
      type: "OTHER" as const,
      title: "Solicitud",
      description: "Descripción suficiente",
      requestedFor: "2026-08-09T18:00:00.000Z",
    };

    expectPortalError(
      () => repository.createServiceRequest({ ...base, station: "LRM" }),
      "FORBIDDEN",
    );
    expectPortalError(
      () =>
        repository.createServiceRequest({
          ...base,
          flightId: "flt_other_secret",
        }),
      "NOT_FOUND",
    );
    expectPortalError(
      () =>
        repository.createServiceRequest({
          ...base,
          requestedFor: "2026-08-09T15:59:59.000Z",
        }),
      "INVALID_INPUT",
    );
    expectPortalError(
      () => withoutCreate.createServiceRequest(base),
      "FORBIDDEN",
    );
  });
});

describe("billing commands", () => {
  it("accepts a pending prebill once and records the response", () => {
    const repository = createRepository();
    const invoice = repository.acceptPrebill(
      "inv_demo_prebill",
      " Montos validados. ",
    );

    expect(invoice).toMatchObject({
      kind: "PREBILL",
      status: "ACCEPTED",
      responseNote: "Montos validados.",
      respondedAt: NOW.toISOString(),
    });
    expect(repository.listAudit()[0]).toMatchObject({
      action: "prebill.accepted",
      entityId: invoice.id,
    });
    expectPortalError(
      () => repository.acceptPrebill("inv_demo_prebill"),
      "INVALID_STATE",
    );
  });

  it("disputes a prebill and creates a linked billing case", () => {
    const repository = createRepository();
    const billingCase = repository.disputePrebill("inv_demo_prebill", {
      subject: "Diferencia de servicios",
      reason: "Se cobraron dos servicios no ejecutados.",
      lineIds: ["line_pre_1", "line_pre_1"],
    });

    expect(billingCase).toMatchObject({
      airlineId: "airline_demo",
      invoiceId: "inv_demo_prebill",
      reconciliationId: null,
      type: "PREBILL_DISPUTE",
      status: "OPEN",
      lineIds: ["line_pre_1"],
    });
    expect(repository.getInvoice("inv_demo_prebill").status).toBe("DISPUTED");
    expect(repository.listBillingCases()).toEqual([billingCase]);
    expect(
      repository
        .listAudit()
        .find((audit) => audit.action === "prebill.disputed"),
    ).toMatchObject({ details: { lineIds: ["line_pre_1"] } });
    expectPortalError(
      () =>
        createRepository().disputePrebill("inv_demo_prebill", {
          reason: "Línea ajena.",
          lineIds: ["line_unknown"],
        }),
      "INVALID_INPUT",
    );
  });

  it("accepts or disputes reconciliation only from a reviewable state", () => {
    const acceptedRepository = createRepository();
    expect(
      acceptedRepository.acceptReconciliation("rec_demo_matched").status,
    ).toBe("ACCEPTED");
    expectPortalError(
      () => acceptedRepository.acceptReconciliation("rec_demo_matched"),
      "INVALID_STATE",
    );

    const disputedRepository = createRepository();
    const billingCase = disputedRepository.disputeReconciliation(
      "rec_demo_pending",
      { reason: "Cantidad de agentes incorrecta." },
    );
    expect(billingCase).toMatchObject({
      invoiceId: null,
      reconciliationId: "rec_demo_pending",
      type: "RECONCILIATION_DISPUTE",
    });
    expect(
      disputedRepository.getReconciliation("rec_demo_pending").status,
    ).toBe("DISPUTED");
  });

  it("opens one claim per issued invoice and prevents duplicates", () => {
    const repository = createRepository();
    const billingCase = repository.claimInvoice("inv_demo_issued", {
      subject: "Impuesto incorrecto",
      description: "El impuesto no coincide con el contrato.",
    });

    expect(billingCase).toMatchObject({
      invoiceId: "inv_demo_issued",
      type: "INVOICE_CLAIM",
      status: "OPEN",
      lineIds: [],
    });
    expectPortalError(
      () =>
        repository.claimInvoice("inv_demo_issued", {
          subject: "Segundo reclamo",
          description: "No debe crearse.",
        }),
      "CONFLICT",
    );
    expectPortalError(
      () =>
        repository.claimInvoice("inv_demo_prebill", {
          subject: "No aplica",
          description: "Una prefactura se disputa, no se reclama.",
        }),
      "INVALID_STATE",
    );
  });

  it("requires billing:respond and preserves tenant-not-found semantics", () => {
    const repository = createRepository(
      createSession({ permissions: ["portal:access", "billing:read"] }),
    );

    expectPortalError(
      () => repository.acceptPrebill("inv_demo_prebill"),
      "FORBIDDEN",
    );
    expectPortalError(
      () => repository.acceptPrebill("inv_other_secret"),
      "NOT_FOUND",
    );
  });
});

describe("notification commands", () => {
  it("marks one or all notifications read idempotently without touching another tenant", () => {
    const repository = createRepository();
    expect(repository.listNotifications({ unreadOnly: true })).toHaveLength(2);

    const first = repository.markNotificationRead("not_demo_billing");
    expect(first.readAt).toBe(NOW.toISOString());
    const auditCount = repository.listAudit().length;
    repository.markNotificationRead("not_demo_billing");
    expect(repository.listAudit()).toHaveLength(auditCount);
    expect(repository.markAllNotificationsRead()).toBe(1);
    expect(repository.markAllNotificationsRead()).toBe(0);
    expect(repository.listNotifications({ unreadOnly: true })).toEqual([]);
    expectPortalError(
      () => repository.markNotificationRead("not_other_secret"),
      "NOT_FOUND",
    );
  });
});

describe("tenant persistence, reset and document download audit", () => {
  it("persists every tenant command and hydrates a later repository instance", () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const options = {
      now: () => NOW,
      localStorage: storage,
      idGenerator: (prefix: string) => `${prefix}_persist_${++sequence}`,
    };
    const first = new MockPortalRepository(createSession(), options);
    const request = first.createServiceRequest({
      station: "PUJ",
      type: "OTHER",
      title: "Persistir solicitud",
      description: "Debe sobrevivir otra instancia.",
      requestedFor: "2026-08-09T20:00:00.000Z",
    });
    first.cancelServiceRequest(request.id, "Prueba de persistencia");
    first.markNotificationRead("not_demo_billing");

    const key = portalStorageKey("airline_demo");
    const raw = storage.getItem(key);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({
      schemaVersion: PORTAL_STORAGE_SCHEMA_VERSION,
      airlineId: "airline_demo",
    });
    expect(raw).not.toContain("airline_other");

    const second = new MockPortalRepository(createSession(), options);
    expect(second.getServiceRequest(request.id)).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "Prueba de persistencia",
    });
    expect(second.getKpis().unreadNotifications).toBe(2);
  });

  it("keeps storage keys tenant-scoped and removes corrupt persisted state", () => {
    const storage = new MemoryStorage();
    storage.setItem(portalStorageKey("airline_demo"), "{broken");

    expect(
      () =>
        new MockPortalRepository(createSession(), {
          now: () => NOW,
          localStorage: storage,
        }),
    ).not.toThrow();
    expect(storage.getItem(portalStorageKey("airline_demo"))).toBeNull();
    expect(portalStorageKey("airline_demo")).not.toBe(
      portalStorageKey("airline_other"),
    );
  });

  it("resets in-memory and persisted mutations to the initial fixture state", () => {
    const storage = new MemoryStorage();
    const repository = new MockPortalRepository(createSession(), {
      now: () => NOW,
      localStorage: storage,
      idGenerator: (prefix) => `${prefix}_reset`,
    });
    repository.acceptPrebill("inv_demo_prebill");
    expect(storage.getItem(portalStorageKey("airline_demo"))).not.toBeNull();

    repository.resetMockState();

    expect(repository.getInvoice("inv_demo_prebill").status).toBe(
      "PENDING_REVIEW",
    );
    expect(storage.getItem(portalStorageKey("airline_demo"))).toBeNull();
  });

  it("records an authorized document download and persists its audit", () => {
    const storage = new MemoryStorage();
    const repository = new MockPortalRepository(createSession(), {
      now: () => NOW,
      localStorage: storage,
      idGenerator: (prefix) => `${prefix}_download`,
    });

    expect(repository.recordDocumentDownload("doc_demo_report")).toMatchObject({
      action: "document.downloaded",
      entityType: "DOCUMENT",
      entityId: "doc_demo_report",
      details: {
        name: "Reporte operativo EV 204.pdf",
        station: "PUJ",
      },
    });
    expect(storage.getItem(portalStorageKey("airline_demo"))).toContain(
      "document.downloaded",
    );
    expectPortalError(
      () => repository.recordDocumentDownload("doc_demo_processing"),
      "INVALID_STATE",
    );
    expectPortalError(
      () => repository.recordDocumentDownload("doc_other_secret"),
      "NOT_FOUND",
    );
  });
});
