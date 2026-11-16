import { describe, expect, it } from "vitest";
import {
  createElevantApiClient,
  ElevantApiError,
  isMasterStand,
  isPermitTypeSettings,
  normalizedPermitTypeCreate,
  normalizedStandRequiredPermits,
} from "../src";

// ADR-0045: Gestión Humana › Configuración and the permits OCC requires at a stand.
const stationId = "20000000-0000-7000-8000-000000000003";
const standId = "20000000-0000-7000-8000-000000000005";
const otherStandId = "20000000-0000-7000-8000-000000000006";
const typeId = "a1000000-0000-7000-8000-000000000001";
const equipmentId = "a2000000-0000-7000-8000-000000000001";
const key = "a0000000-0000-7000-8000-000000000009";
const system = [
  { id: null, code: "AirportId", name: "Carnet aeroportuario", description: null, isActive: true, isSystem: true,
    inUse: true, version: null },
  { id: null, code: "RampDriverLicense", name: "Licencia de conducir en rampa", description: null, isActive: true,
    isSystem: true, inUse: true, version: null },
];
const custom = { id: typeId, code: "ZONA-RESTRINGIDA", name: "Carnet de zona restringida", description: null,
  isActive: true, isSystem: false, inUse: false, version: "AAAAAAAAB9E=" };
const equipment = { id: equipmentId, code: "BOARDING-BRIDGE", name: "Puente de abordaje", requiresQualification: true,
  isActive: true, isLocked: true, inUse: true, version: "AAAAAAAAB9F=" };
const required = [{ code: "ZONA-RESTRINGIDA", name: "Carnet de zona restringida" }];
const stand = (id: string, code: string) => ({ id, terminalId: null, code, hasBoardingBridge: false, isRemote: false,
  maxAircraftSize: null, isActive: true, hasHistory: false, version: "AAAAAAAAB9G=", requiredPermits: required });

type Call = { url: string; method: string; headers: Headers; body: string };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input).replace("https://api.example.test", ""), method: init?.method ?? "GET",
        headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
}

describe("permit types (Gestión Humana › Configuración)", () => {
  it("reads the system types first and the custom ones, strictly", async () => {
    const settings = { permitTypes: [...system, custom], canCreate: true, canUpdate: true };
    const calls: Call[] = [];
    const api = client([Response.json(settings), Response.json({ ...settings, extra: 1 })], calls);
    await expect(api.listHumanResourcesPermitTypes()).resolves.toEqual(settings);
    expect(calls[0]!.url).toBe("/api/v1/human-resources/settings/permit-types");
    await expect(api.listHumanResourcesPermitTypes()).rejects.toMatchObject({ kind: "malformed-response" });
    // A system type never carries an id or a version; a custom one never takes a system code.
    expect(isPermitTypeSettings({ ...settings, permitTypes: [{ ...system[0], version: "x" }] })).toBe(false);
    expect(isPermitTypeSettings({ ...settings, permitTypes: [{ ...custom, code: "AirportId" }] })).toBe(false);
  });

  it("creates with the key and an upper-case code, and explains a refusal by its code", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(custom, { status: 201 }), Response.json({ title: "x", status: 409,
      code: "code_in_use" }, { status: 409, headers: { "content-type": "application/problem+json" } })], calls);
    await expect(api.createHumanResourcesPermitType({ code: " zona-restringida ", name: " Carnet de zona restringida ",
      description: " " }, key)).resolves.toEqual(custom);
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(calls[0]!.body)).toEqual({ code: "ZONA-RESTRINGIDA", name: "Carnet de zona restringida",
      description: null });
    const refused = await api.updateHumanResourcesPermitType(typeId, { code: "ZONA-B", name: custom.name,
      description: null, isActive: true, expectedVersion: custom.version }, key).catch(error => error);
    expect(refused).toBeInstanceOf(ElevantApiError);
    expect(refused).toMatchObject({ status: 409, code: "code_in_use" });
    expect(() => normalizedPermitTypeCreate({ code: "airportid", name: "Otro", description: null })).toThrow(TypeError);
  });

  it("reads and updates the equipment types", async () => {
    const calls: Call[] = [];
    const api = client([Response.json({ equipmentTypes: [equipment], canCreate: false, canUpdate: true }),
      Response.json({ ...equipment, name: "Pasarela" })], calls);
    await expect(api.listHumanResourcesEquipmentTypes()).resolves.toMatchObject({ canUpdate: true });
    await expect(api.updateHumanResourcesEquipmentType(equipmentId, { code: "boarding-bridge", name: "Pasarela",
      requiresQualification: true, isActive: true, expectedVersion: equipment.version }, key))
      .resolves.toMatchObject({ name: "Pasarela" });
    expect(calls[1]).toMatchObject({ method: "PUT", url: `/api/v1/human-resources/settings/equipment-types/${equipmentId}` });
    expect(JSON.parse(calls[1]!.body).code).toBe("BOARDING-BRIDGE");
  });
});

describe("permits a stand requires (OCC master data)", () => {
  it("sets one stand's list with its version and applies a list to several stands", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(stand(standId, "A01")),
      Response.json({ stands: [stand(standId, "A01"), stand(otherStandId, "A02")] })], calls);
    await expect(api.setOccStandRequiredPermits(standId, { documentTypeCodes: ["ZONA-RESTRINGIDA", "ZONA-RESTRINGIDA"],
      expectedVersion: "AAAAAAAAB9G=" }, key)).resolves.toMatchObject({ requiredPermits: required });
    expect(calls[0]).toMatchObject({ method: "PUT", url: `/api/v1/occ/master-data/stands/${standId}/required-permits` });
    expect(JSON.parse(calls[0]!.body)).toEqual({ documentTypeCodes: ["ZONA-RESTRINGIDA"], expectedVersion: "AAAAAAAAB9G=" });
    await expect(api.applyOccStandRequiredPermits({ stationId, standIds: [standId, otherStandId],
      documentTypeCodes: ["ZONA-RESTRINGIDA"] }, key)).resolves.toMatchObject({ stands: [{ code: "A01" }, { code: "A02" }] });
    expect(calls[1]).toMatchObject({ method: "POST", url: "/api/v1/occ/master-data/stands/required-permits" });
    expect(() => normalizedStandRequiredPermits({ documentTypeCodes: ["no válido"], expectedVersion: "x" })).toThrow(TypeError);
  });

  it("keeps accepting a stand without the list (an older server) and refuses a malformed one", () => {
    const { requiredPermits: _omitted, ...older } = stand(standId, "A01");
    expect(isMasterStand(older)).toBe(true);
    expect(isMasterStand({ ...older, requiredPermits: [{ code: "x y", name: "Z" }] })).toBe(false);
  });

  it("carries the names of the missing permits of a refused coverage", async () => {
    const api = client([Response.json({ title: "The coverage breaks assignment rules.", status: 422,
      code: "coverage_rejected", reasons: ["required_permit_missing"], missingPermits: ["Carnet de zona restringida"] },
    { status: 422, headers: { "content-type": "application/problem+json" } })]);
    const error = await api.createOccCoverage({ stationId, date: "2026-11-18", agentId: typeId, terminalId: otherStandId,
      standIds: [standId], isReinforcement: false }, { idempotencyKey: key }).catch(failure => failure);
    expect(error).toMatchObject({ status: 422, reasons: ["required_permit_missing"],
      missingPermits: ["Carnet de zona restringida"] });
  });
});
