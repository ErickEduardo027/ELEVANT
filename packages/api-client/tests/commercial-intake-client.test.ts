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
};
const request: SubmitCommercialRequestRequest = {
  requestId, airlineProfileId, serviceIds: [serviceId],
  representativeName: "Alex Test", representativeTitle: "Operations Manager",
  representativeEmail: "alex@synthetic.example.test",
  representativePhone: "+1 809 555 0100", authorityDeclared: true,
  representativeDocumentType: "NationalId", representativeDocumentNumber: "001-1234567-3",
  taxRegistration: "131234569", taxRegistrationCountryCode: "DO",
};

describe("canonical public commercial intake client", () => {
  it("requires the airline's tax identifier: an RNC for a Dominican airline", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ reference: "REQ", replayed: false }),
        { status: 201, headers: { "content-type": "application/json" } }) });
    for (const tax of [{ taxRegistration: null, taxRegistrationCountryCode: null },
      { taxRegistration: "13123456", taxRegistrationCountryCode: "DO" },
      { taxRegistration: "ab", taxRegistrationCountryCode: "US" }])
      await expect(client.submitCommercialRequest({ ...request, ...tax })).rejects.toBeInstanceOf(TypeError);
    // A proposed Dominican airline cannot give a foreign identifier.
    await expect(client.submitCommercialRequest({ ...request, airlineProfileId: null,
      proposedAirline: { name: "Caribe Cargo", countryCode: "DO", iataCode: null, icaoCode: "CCX" },
      taxRegistration: "EIN 12-3456789", taxRegistrationCountryCode: "US" })).rejects.toBeInstanceOf(TypeError);
    await expect(client.submitCommercialRequest({ ...request, taxRegistration: "EIN 12-3456789",
      taxRegistrationCountryCode: "US" })).resolves.toEqual({ reference: "REQ", replayed: false });
  });

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

  it("reads the tax identifier of a catalog airline when the server sends it, both values or neither", async () => {
    const read = (airline: Record<string, unknown>) => createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => new Response(JSON.stringify({ ...catalog, airlines: [{ ...catalog.airlines[0], ...airline }] }),
        { headers: { "content-type": "application/json" } }) }).getPublicCommercialCatalog();
    const withRnc = { countryCode: "DO", taxRegistration: "131234569", taxRegistrationCountryCode: "DO" };
    await expect(read(withRnc)).resolves.toMatchObject({ airlines: [withRnc] });
    await expect(read({ taxRegistration: "131234569" })).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(read({ taxRegistration: "131234569", taxRegistrationCountryCode: "do" }))
      .rejects.toMatchObject({ kind: "malformed-response" });
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
      representativeDocumentType: "Passport", representativeDocumentNumber: "RD1234567",
      representativeDistrict: null, representativePhone: "849-246-3371" };

    await expect(client.submitCommercialRequest(application)).resolves.toEqual({
      reference: "REQ-2", replayed: false,
    });
    expect(sent).toEqual(application);
  });

  it("proposes an airline that is not in the catalog with its ICAO code and no IATA", async () => {
    let sent: unknown;
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ reference: "REQ-3", replayed: false }),
          { status: 201, headers: { "content-type": "application/json" } });
      },
    });
    const proposal = { ...request, airlineProfileId: null, proposedAirline: { name: "Caribe Cargo Express",
      countryCode: "DO", iataCode: null, icaoCode: "CCX", websiteUrl: "https://caribecargo.example.com" } };
    await expect(client.submitCommercialRequest(proposal)).resolves.toEqual({ reference: "REQ-3", replayed: false });
    expect(sent).toEqual(proposal);
    for (const invalid of [
      { ...proposal, airlineProfileId },
      { ...proposal, proposedAirline: { ...proposal.proposedAirline, icaoCode: "CC" } },
      { ...proposal, proposedAirline: { ...proposal.proposedAirline, iataCode: "12" } },
      { ...proposal, proposedAirline: { ...proposal.proposedAirline, websiteUrl: "http://caribecargo.example.com" } },
      { ...proposal, proposedAirline: { ...proposal.proposedAirline, countryCode: "do" } },
      { ...proposal, proposedAirline: null },
    ])
      await expect(client.submitCommercialRequest(invalid)).rejects.toBeInstanceOf(TypeError);
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
    // The representative must be identified: no document, «Other», or a passport without nationality.
    await expect(client.submitCommercialRequest({ ...request, representativeDocumentType: null,
      representativeDocumentNumber: null })).rejects.toBeInstanceOf(TypeError);
    await expect(client.submitCommercialRequest({ ...request, representativeDocumentType: "Other",
      representativeDocumentNumber: "LIC-12345" })).rejects.toBeInstanceOf(TypeError);
    await expect(client.submitCommercialRequest({ ...request, representativeDocumentType: "Passport",
      representativeDocumentNumber: "RD1234567" })).rejects.toBeInstanceOf(TypeError);
    await expect(client.submitCommercialRequest(request)).rejects.toMatchObject({
      kind: "malformed-response",
    });
  });
});
