import { describe, expect, it } from "vitest";
import { createElevantApiClient, isManagedService, isServiceClosure } from "../src";
import { ELEVANT_API_ERROR_CODES } from "../src/errors";

const serviceId = "80000000-0000-7000-8000-0000000000d1";
const closureId = "70000000-0000-7000-8000-0000000000d2";
const accountId = "40000000-0000-7000-8000-000000000005";
const key = "a0000000-0000-7000-8000-0000000000d3";
const version = "AAAAAAAAB9E=";

const service = {
  id: serviceId, code: "RAMP-GPU", name: "Unidad generadora de energía",
  description: "Energía eléctrica en tierra para la aeronave.", billingUnit: "hour",
  imageUrl: "/assets/services/ground-power.webp", videoUrl: null, displayOrder: 4,
  isPublic: false, isActive: true, version,
};
const closure = {
  id: closureId, serviceId, serviceName: "Unidad generadora de energía",
  reason: "La unidad generadora está fuera de servicio.", status: "Approved", requestedBy: accountId,
  requestedAt: "2026-11-06T13:37:21.123+00:00", decisionReason: null, decidedBy: accountId,
  decidedAt: "2026-11-06T13:40:02.5+00:00", reopenedAt: null, reopenReason: null,
  isCurrentlyPublic: false, isServiceActive: false, serviceVersion: "AAAAAAAACOw=", version: "AAAAAAAACO4=",
};

type Call = { url: string; method: string; headers: Headers; body: string };
function client(answers: Response[]) {
  const calls: Call[] = [];
  const api = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers),
        body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
  return { api, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const problem = (status: number, code: string) => new Response(JSON.stringify({ title: "Título en español", status, code }),
  { status, headers: { "content-type": "application/problem+json" } });

describe("catalog and closure client", () => {
  it("hides a service with the form: the key, the version on screen and a normalized body", async () => {
    const { api, calls } = client([json(service)]);
    await expect(api.updateManagedService(serviceId, {
      code: " ramp-gpu ", name: " Unidad generadora de energía ", description: "Energía eléctrica en tierra para la aeronave.",
      billingUnit: "hour", imageUrl: "/assets/services/ground-power.webp", videoUrl: "", displayOrder: 4,
      isPublic: false, isActive: true, version,
    }, key)).resolves.toEqual(service);
    expect([calls[0]!.method, calls[0]!.url]).toEqual(["PUT",
      `https://api.example.test/api/v1/contracts/catalog/services/${serviceId}`]);
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");
    expect(JSON.parse(calls[0]!.body)).toEqual({ code: "RAMP-GPU", name: "Unidad generadora de energía",
      description: "Energía eléctrica en tierra para la aeronave.", billingUnit: "hour",
      imageUrl: "/assets/services/ground-power.webp", videoUrl: null, displayOrder: 4, isPublic: false, isActive: true,
      version });
  });

  it("retires a service with a trimmed reason and keeps the code of a refusal", async () => {
    const retired = { ...service, isActive: false, isPublic: false };
    const { api, calls } = client([json(retired), problem(409, "service_in_active_contract")]);
    await expect(api.retireManagedService(serviceId,
      { expectedVersion: version, reason: "  AVIAM deja de prestar este servicio.  " }, key)).resolves.toEqual(retired);
    expect([calls[0]!.method, calls[0]!.url]).toEqual(["POST",
      `https://api.example.test/api/v1/contracts/catalog/services/${serviceId}/retirement`]);
    expect(JSON.parse(calls[0]!.body)).toEqual({ expectedVersion: version, reason: "AVIAM deja de prestar este servicio." });
    await expect(api.retireManagedService(serviceId,
      { expectedVersion: version, reason: "AVIAM deja de prestar este servicio." }, key))
      .rejects.toMatchObject({ kind: "http", status: 409, code: "service_in_active_contract" });
  });

  it("refuses commands the server never accepts before any request", async () => {
    const { api, calls } = client([]);
    await expect(api.retireManagedService(serviceId, { expectedVersion: version, reason: "corto" }, key))
      .rejects.toBeInstanceOf(TypeError);
    await expect(api.retireManagedService(serviceId, { expectedVersion: "not a version!", reason: "Motivo suficiente." }, key))
      .rejects.toBeInstanceOf(TypeError);
    await expect(api.retireManagedService(serviceId, { expectedVersion: version, reason: "Motivo suficiente." }, "nope"))
      .rejects.toBeInstanceOf(TypeError);
    // A denial explains itself.
    await expect(api.decideServiceClosure(closureId, { approve: false, reason: " ", version }, key))
      .rejects.toBeInstanceOf(TypeError);
    await expect(api.reopenService(serviceId, { reason: "corto", serviceVersion: version }, key))
      .rejects.toBeInstanceOf(TypeError);
    await expect(api.updateManagedService(serviceId, { ...service, code: "ramp gpu" }, key))
      .rejects.toBeInstanceOf(TypeError);
    // @ts-expect-error unknown keys are refused on purpose
    await expect(api.updateManagedService(serviceId, { ...service, id: serviceId }, key)).rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("decides a closure with its key and answers the request with the state of its service", async () => {
    const { api, calls } = client([json(closure)]);
    await expect(api.decideServiceClosure(closureId, { approve: true, reason: "  ", version: "AAAAAAAACO0=" }, key))
      .resolves.toEqual(closure);
    expect([calls[0]!.method, calls[0]!.url]).toEqual(["POST",
      `https://api.example.test/api/v1/service-closures/${closureId}/decision`]);
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(calls[0]!.body)).toEqual({ approve: true, reason: null, version: "AAAAAAAACO0=" });
  });

  it("reopens a service and answers the closure of the service in the route", async () => {
    const reopened = { ...closure, reopenedAt: "2026-11-07T08:00:00+00:00", reopenReason: "El equipo volvió a funcionar.",
      isCurrentlyPublic: true, isServiceActive: true };
    const { api, calls } = client([json(reopened), json({ ...reopened, serviceId: closureId })]);
    await expect(api.reopenService(serviceId, { reason: "El equipo volvió a funcionar.", serviceVersion: version }, key))
      .resolves.toEqual(reopened);
    expect([calls[0]!.method, calls[0]!.url]).toEqual(["POST",
      `https://api.example.test/api/v1/service-closures/services/${serviceId}/reopen`]);
    expect(JSON.parse(calls[0]!.body)).toEqual({ reason: "El equipo volvió a funcionar.", serviceVersion: version });
    await expect(api.reopenService(serviceId, { reason: "El equipo volvió a funcionar.", serviceVersion: version }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("validates the answers strictly", () => {
    expect(isManagedService(service, serviceId)).toBe(true);
    expect(isManagedService({ ...service, imageUrl: undefined, videoUrl: undefined })).toBe(true);
    expect(isManagedService(service, closureId)).toBe(false);
    expect(isManagedService({ ...service, contracts: 2 })).toBe(false);
    expect(isManagedService({ ...service, displayOrder: 1.5 })).toBe(false);
    expect(isManagedService({ ...service, isActive: "false" })).toBe(false);
    expect(isServiceClosure(closure, { id: closureId, serviceId })).toBe(true);
    expect(isServiceClosure({ ...closure, status: "Reopened" })).toBe(false);
    expect(isServiceClosure({ ...closure, isServiceActive: undefined })).toBe(false);
    expect(isServiceClosure({ ...closure, requestedAt: "06/11/2026" })).toBe(false);
    expect(isServiceClosure({ ...closure, internalNote: "x" })).toBe(false);
  });

  it("knows the catalog codes once", () => {
    for (const code of ["service_in_active_contract", "retirement_command_required", "closure_requires_reopen",
      "service_code_exists", "image_required", "closure_self_decision", "no_approved_closure", "service_retired"])
      expect(ELEVANT_API_ERROR_CODES).toContain(code);
    expect(new Set(ELEVANT_API_ERROR_CODES).size).toBe(ELEVANT_API_ERROR_CODES.length);
  });
});
