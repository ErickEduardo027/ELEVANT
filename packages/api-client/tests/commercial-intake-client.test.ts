import { describe, expect, it } from "vitest";
import { createElevantApiClient, type SubmitCommercialRequestRequest } from "../src";

const serviceId = "20000000-0000-7000-8000-000000000006";
const airlineProfileId = "20000000-0000-7000-8000-000000000003";
const requestId = "70000000-0000-7000-8000-000000000001";
const catalog = {
  services: [{ id: serviceId, name: "Baggage handling", description: "Ramp service",
    imageUrl: null, videoUrl: null, displayOrder: 1 }],
  airlines: [{ id: airlineProfileId, name: "Synthetic Airways", region: "Caribbean",
    legalName: null, countryCode: null, iataCode: null, icaoCode: null,
    logoUrl: null, isVerified: false }],
  packages: [],
};
const request: SubmitCommercialRequestRequest = {
  requestId, airlineProfileId, serviceIds: [serviceId],
  representativeName: "Alex Test", representativeTitle: "Operations Manager",
  representativeEmail: "alex@synthetic.example.test",
  representativePhone: "+1 809 555 0100", authorityDeclared: true,
};

describe("canonical public commercial intake client", () => {
  it("reads the public catalog anonymously and rejects extra private fields", async () => {
    const calls: Array<{ url: string; method: string | undefined; auth: string | null }> = [];
    const client = createElevantApiClient({
      baseUrl: "https://api.example.test", getAccessToken: () => "must-not-be-used",
      fetch: async (url, init) => {
        calls.push({ url: String(url), method: init?.method,
          auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify(catalog),
          { headers: { "content-type": "application/json" } });
      },
    });
    await expect(client.getPublicCommercialCatalog()).resolves.toEqual(catalog);
    expect(calls).toEqual([{ url: "https://api.example.test/api/v1/public/commercial-catalog",
      method: "GET", auth: null }]);

    const unsafe = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...catalog,
        airlines: [{ ...catalog.airlines[0], passwordHash: "synthetic" }] }),
      { headers: { "content-type": "application/json" } }) });
    await expect(unsafe.getPublicCommercialCatalog()).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("accepts the full server catalog without an undocumented client-only size cap", async () => {
    const largeCatalog = {
      ...catalog,
      services: Array.from({ length: 1001 }, (_, index) => ({
        ...catalog.services[0], id: `20000000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      })),
      airlines: Array.from({ length: 1001 }, (_, index) => ({
        ...catalog.airlines[0], id: `30000000-0000-7000-8000-${String(index).padStart(12, "0")}`,
      })),
    };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify(largeCatalog),
        { headers: { "content-type": "application/json" } }) });
    await expect(client.getPublicCommercialCatalog()).resolves.toEqual(largeCatalog);
  });

  it("keeps services available when an older API omits packages", async () => {
    const olderCatalog = { services: catalog.services, airlines: catalog.airlines };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify(olderCatalog),
        { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getPublicCommercialCatalog()).resolves.toEqual(catalog);
  });

  it("reads published package components without exposing a package price", async () => {
    const published = { ...catalog, packages: [{
      id: "30000000-0000-7000-8000-000000000001", code: "RAMP-BASIC",
      name: "Rampa básica", versionNumber: 2, currencyCode: "USD",
      components: [{ serviceId, code: "BAG", name: "Baggage handling",
        billingUnit: "Flight", includedQuantity: 1 }],
    }] };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify(published),
        { headers: { "content-type": "application/json" } }),
    });
    await expect(client.getPublicCommercialCatalog()).resolves.toEqual(published);
    const unsafe = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...published,
        packages: [{ ...published.packages[0], price: 100 }] }),
      { headers: { "content-type": "application/json" } }),
    });
    await expect(unsafe.getPublicCommercialCatalog()).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });

  it("posts a stable request id without credentials and accepts a new or replayed receipt", async () => {
    const calls: Array<{ body: unknown; auth: string | null }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "must-not-be-used",
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)),
          auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ reference: "REQ-SYNTHETIC-001",
          replayed: calls.length > 1 }),
        { status: calls.length > 1 ? 200 : 201,
          headers: { "content-type": "application/json" } });
      },
    });
    await expect(client.submitCommercialRequest(request)).resolves.toEqual({
      reference: "REQ-SYNTHETIC-001", replayed: false,
    });
    await expect(client.submitCommercialRequest(request)).resolves.toEqual({
      reference: "REQ-SYNTHETIC-001", replayed: true,
    });
    expect(calls).toEqual([{ body: request, auth: null }, { body: request, auth: null }]);
  });

  it("accepts package-only requests and rejects duplicate package versions", async () => {
    const packageId = "30000000-0000-7000-8000-000000000001";
    let sent: unknown;
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ reference: "REQ-PACKAGE-1", replayed: false }),
          { status: 201, headers: { "content-type": "application/json" } });
      },
    });
    const packageOnly = { ...request, serviceIds: [], packageVersionIds: [packageId] };
    await expect(client.submitCommercialRequest(packageOnly)).resolves.toEqual({
      reference: "REQ-PACKAGE-1", replayed: false,
    });
    expect(sent).toEqual(packageOnly);
    await expect(client.submitCommercialRequest({ ...packageOnly,
      packageVersionIds: [packageId, packageId] })).rejects.toBeInstanceOf(TypeError);
  });

  it("looks up an existing receipt without repeating the submission", async () => {
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "must-not-be-used",
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)),
          auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ reference: "REQ-SYNTHETIC-001", replayed: true }),
          { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    await expect(client.lookupCommercialRequestReceipt(request)).resolves.toEqual({
      reference: "REQ-SYNTHETIC-001", replayed: true,
    });
    expect(calls).toEqual([{ url: "https://api.example.test/api/v1/public/commercial-requests/receipt",
      body: request, auth: null }]);
  });

  it("accepts optional representative identity and address without sending credentials", async () => {
    let sent: unknown;
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ reference: "REQ-2", replayed: false }),
          { status: 201, headers: { "content-type": "application/json" } });
      },
    });
    const application = { ...request, representativeNationalityCode: "DO",
      representativeAddress: "Avenida Principal 10", representativeCountry: "República Dominicana",
      representativeProvince: "Santo Domingo", representativeMunicipality: "Boca Chica",
      representativeDocumentType: "Passport", representativeDocumentNumber: "AB123456" };

    await expect(client.submitCommercialRequest(application)).resolves.toEqual({
      reference: "REQ-2", replayed: false,
    });
    expect(sent).toEqual(application);
  });

  it("rejects stale ids, missing authority and a misleading success response", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ reference: "REQ-SYNTHETIC-001",
        replayed: false, accountActivated: true }),
      { status: 201, headers: { "content-type": "application/json" } }) });
    await expect(client.submitCommercialRequest({ ...request, serviceIds: ["stale"] }))
      .rejects.toBeInstanceOf(TypeError);
    await expect(client.submitCommercialRequest({ ...request, authorityDeclared: false }))
      .rejects.toBeInstanceOf(TypeError);
    await expect(client.submitCommercialRequest(request)).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });
});
