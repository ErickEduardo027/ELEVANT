import { describe, expect, it } from "vitest";
import { createElevantApiClient, type AirlineContractPageResponse,
  type AirlinePortalBootstrapResponse } from "../src";

const bootstrap: AirlinePortalBootstrapResponse = {
  airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: "10000000-0000-7000-8000-000000000002",
  iataCode: "ZZ",
  icaoCode: "DVA",
  name: "Demo Airlines",
  stations: [{
    id: "20000000-0000-7000-8000-000000000003",
    code: "PUJ",
    name: "Punta Cana",
    ianaTimeZone: "America/Santo_Domingo",
  }],
  currentOperations: [{
    id: "70000000-0000-7000-8000-000000000005",
    code: "DEV-TAT-0001",
    stationId: "20000000-0000-7000-8000-000000000003",
    stationCode: "PUJ",
    operationDate: "2026-09-25",
    status: "Assigned",
    arrivalFlightNumber: "ZZ100",
    departureFlightNumber: "ZZ101",
    plannedStartAt: "2026-09-25T12:45:00Z",
    plannedEndAt: "2026-09-25T14:30:00Z",
  }],
};

describe("airline portal bootstrap client", () => {
  it("gets server-resolved tenant scope without client authority parameters", async () => {
    const requests: Array<{ url: string; method: string | undefined;
      body: BodyInit | null | undefined; headers: Headers }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), method: init?.method, body: init?.body,
          headers: new Headers(init?.headers) });
        return new Response(JSON.stringify(bootstrap), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    await expect(client.getAirlinePortalBootstrap()).resolves.toEqual(bootstrap);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.test/api/v1/airline/portal/bootstrap");
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.body).toBeUndefined();
    expect(requests[0]?.headers.get("authorization"))
      .toBe("Bearer airline-token");
  });

  it("rejects a malformed or mixed-tenant response", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({
        ...bootstrap,
        stations: [{ ...bootstrap.stations[0], airlineId: crypto.randomUUID() }],
      }), { headers: { "content-type": "application/json" } }),
    });

    await expect(client.getAirlinePortalBootstrap()).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });

  it("rejects a mixed-station operation payload", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({
        ...bootstrap,
        currentOperations: [{ ...bootstrap.currentOperations[0], stationId: crypto.randomUUID() }],
      }), { headers: { "content-type": "application/json" } }),
    });

    await expect(client.getAirlinePortalBootstrap()).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });
});

const contracts: AirlineContractPageResponse = {
  page: 1,
  limit: 20,
  hasMore: false,
  contracts: [{
    id: "60000000-0000-7000-8000-000000000002",
    code: "DEV-CONTRACT-0001",
    status: "Active",
    signedOn: "2026-01-01",
    terminatedOn: null,
    approvedVersions: [{
      id: "60000000-0000-7000-8000-000000000003",
      versionNumber: 1,
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      currencyCode: "USD",
      stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ", name: "Punta Cana" }],
      rates: [{ id: "60000000-0000-7000-8000-000000000004", serviceCode: "BAG",
        serviceName: "Baggage", billingUnit: "operation", unitPrice: 125.50,
        minimumQuantity: 1 }],
    }],
  }],
};

describe("airline contract client", () => {
  it("uses the authenticated tenant and bounded paging only", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify(contracts), { headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.getAirlineContracts({ page: 1, limit: 20 })).resolves.toEqual(contracts);
    expect(requests).toEqual([{ url: "https://api.example.test/api/v1/airline/portal/contracts?page=1&limit=20",
      authorization: "Bearer airline-token" }]);
    await expect(client.getAirlineContracts({ page: 0 })).rejects.toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(1);
  });

  it("rejects malformed rate and unexpected tenant fields", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...contracts,
        contracts: [{ ...contracts.contracts[0], organizationId: crypto.randomUUID() }],
      }), { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getAirlineContracts()).rejects.toMatchObject({ kind: "malformed-response" });
  });
});

describe("airline operation history client", () => {
  const history = {
    page: 2, limit: 1, hasMore: false,
    operations: [{ ...bootstrap.currentOperations[0], operationDate: "2026-08-18" }],
  };

  it("reads a bounded historical page without letting the browser choose a tenant", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url, init) => {
        requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify(history), { headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.getAirlineOperations({ page: 2, limit: 1 })).resolves.toEqual(history);
    expect(requests).toEqual([{ url: "https://api.example.test/api/v1/airline/portal/operations?page=2&limit=1",
      authorization: "Bearer airline-token" }]);
    await expect(client.getAirlineOperations({ limit: 51 })).rejects.toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(1);
  });

  it("rejects an unexpected tenant field in the historical payload", async () => {
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...history,
        operations: [{ ...history.operations[0], organizationId: crypto.randomUUID() }],
      }), { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getAirlineOperations({ page: 2, limit: 1 })).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });

  it("reads a historical operation by its public ID without a browser tenant", async () => {
    const operation = { ...bootstrap.currentOperations[0], operationDate: "2026-08-18" };
    const requests: string[] = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url) => {
        requests.push(String(url));
        return new Response(JSON.stringify(operation),
          { headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.getAirlineOperation(operation.id!)).resolves.toEqual(operation);
    expect(requests).toEqual([
      `https://api.example.test/api/v1/airline/portal/operations/${operation.id}`,
    ]);
    await expect(client.getAirlineOperation("not-a-guid")).rejects.toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(1);
  });

  it("accepts only sanitized approved evidence for the exact operation", async () => {
    const operationId = bootstrap.currentOperations[0]!.id!;
    const evidence = {
      operationId, available: true, approvedAt: "2026-08-18T15:00:00Z",
      actualStartAt: "2026-08-18T13:00:00Z",
      actualEndAt: "2026-08-18T14:50:00Z", incidentCount: 0,
      services: [{ id: crypto.randomUUID(), code: "BAGGAGE", name: "Baggage handling",
        status: "Completed", contractedQuantity: 1, executedQuantity: 1,
        billingUnit: "operation" }],
    };
    const urls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(evidence),
          { headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.getAirlineApprovedOperationEvidence(operationId)).resolves.toEqual(evidence);
    expect(urls).toEqual([
      `https://api.example.test/api/v1/airline/portal/operations/${operationId}/approved-evidence`,
    ]);
    await expect(client.getAirlineApprovedOperationEvidence("not-a-guid"))
      .rejects.toBeInstanceOf(TypeError);
    expect(urls).toHaveLength(1);

    const leaking = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...evidence, agentNote: "private" }),
        { headers: { "content-type": "application/json" } }),
    });
    await expect(leaking.getAirlineApprovedOperationEvidence(operationId))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });
});

describe("airline operational requests client", () => {
  const page = { page: 1, limit: 20, hasMore: false, requests: [{
    id: "73000000-0000-7000-8000-000000000001",
    stationId: "20000000-0000-7000-8000-000000000003",
    stationCode: "PUJ", serviceName: "Escalera adicional",
    description: "Solicitud para desembarque posterior.", status: "Submitted",
    requestedAt: "2026-08-19T12:03:00Z", neededAt: "2026-08-19T12:15:00Z",
    operationId: "70000000-0000-7000-8000-000000000016",
    operationCode: "DEV-TAT-0002", resolvedAt: null,
  }] };

  it("reads only the authenticated airline's paginated operational requests", async () => {
    const urls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(page),
          { headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.getAirlineOperationalRequests({ page: 1, limit: 20 }))
      .resolves.toEqual(page);
    expect(urls).toEqual([
      "https://api.example.test/api/v1/airline/portal/requests?page=1&limit=20",
    ]);
    await expect(client.getAirlineOperationalRequests({ limit: 51 }))
      .rejects.toBeInstanceOf(TypeError);
    expect(urls).toHaveLength(1);
  });

  it("rejects an injected tenant or incoherent operation link", async () => {
    const payloads = [
      { ...page, requests: [{ ...page.requests[0], organizationId: crypto.randomUUID() }] },
      { ...page, requests: [{ ...page.requests[0], operationId: null }] },
    ];
    for (const payload of payloads) {
      const client = createElevantApiClient({ baseUrl: "https://api.example.test",
        fetch: async () => new Response(JSON.stringify(payload),
          { headers: { "content-type": "application/json" } }),
      });
      await expect(client.getAirlineOperationalRequests())
        .rejects.toMatchObject({ kind: "malformed-response" });
    }
  });
});

describe("published airline preinvoices client", () => {
  const page = { page: 1, limit: 20, hasMore: false, preinvoices: [{
    id: "74000000-0000-7000-8000-000000000001",
    stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
    from: "2026-08-18", to: "2026-08-19", currencyCode: "USD",
    total: 125.5, status: "Submitted", createdAt: "2026-08-20T12:00:00Z",
  }] };

  it("reads a bounded tenant-derived page and rejects an internal draft", async () => {
    const urls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(page),
          { headers: { "content-type": "application/json" } });
      },
    });

    await expect(client.getAirlinePreinvoices({ page: 1, limit: 20 }))
      .resolves.toEqual(page);
    expect(urls).toEqual([
      "https://api.example.test/api/v1/airline/portal/preinvoices?page=1&limit=20&includeVoided=true",
    ]);
    await expect(client.getAirlinePreinvoices({ limit: 51 }))
      .rejects.toBeInstanceOf(TypeError);
    expect(urls).toHaveLength(1);

    const invalid = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...page,
        preinvoices: [{ ...page.preinvoices[0], status: "Draft" }] }),
        { headers: { "content-type": "application/json" } }),
    });
    await expect(invalid.getAirlinePreinvoices())
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("reads published line snapshots by public ID without a browser tenant", async () => {
    const detail = { ...page.preinvoices[0], lines: [{
      id: "74000000-0000-7000-8000-000000000002",
      operationCode: "DEV-TAT-0021", operationDate: "2026-08-18",
      serviceCode: "GPU", serviceName: "Ground power",
      executedQuantity: 1, billingUnit: "hour", unitPrice: 125.5, amount: 125.5,
    }] };
    const urls: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "airline-token",
      fetch: async url => {
        urls.push(String(url));
        return new Response(JSON.stringify(detail),
          { headers: { "content-type": "application/json" } });
      },
    });
    await expect(client.getAirlinePreinvoice(detail.id!)).resolves.toEqual(detail);
    expect(urls).toEqual([
      `https://api.example.test/api/v1/airline/portal/preinvoices/${detail.id}?includeVoided=true`,
    ]);
    await expect(client.getAirlinePreinvoice("not-a-guid")).rejects.toBeInstanceOf(TypeError);
    expect(urls).toHaveLength(1);
  });

  it("accepts a published void with retained line snapshots as airline history", async () => {
    const voided = { ...page.preinvoices[0], status: "Voided" };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async url => new Response(JSON.stringify(String(url).includes("/preinvoices/")
        ? { ...voided, lines: [{
          id: "74000000-0000-7000-8000-000000000002",
          operationCode: "DEV-TAT-0021", operationDate: "2026-08-18",
          serviceCode: "GPU", serviceName: "Ground power",
          executedQuantity: 1, billingUnit: "hour", unitPrice: 125.5, amount: 125.5,
        }] }
        : { ...page, preinvoices: [voided] }),
      { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getAirlinePreinvoices()).resolves.toEqual({
      ...page, preinvoices: [voided],
    });
    await expect(client.getAirlinePreinvoice(voided.id!)).resolves.toMatchObject(voided);
  });
});
