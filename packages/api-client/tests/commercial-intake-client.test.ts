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
