import { describe, expect, it } from "vitest";
import { AIRCRAFT_SILHOUETTE, createElevantApiClient, normalizedSignature, OPERATION_DOCUMENT_SIGNERS } from "../src";

const operationId = "70000000-0000-7000-8000-000000000005";
const installationId = "81000000-0000-7000-8000-000000000071";
const key = "82000000-0000-7000-8000-000000000071";
const markId = "84000000-0000-7000-8000-000000000071";
const sha = "a".repeat(64);
const documents = {
  operationId,
  documents: [{
    kind: "ServiceOrder", number: "PUJ000000005", title: "Orden de Servicio en Rampa / Ramp Order Service",
    formCode: "F-RAM-AVL-MAG 04", contentSha256: sha, requiredRoles: ["AirlineRepresentative", "AviamAgent"],
    signatures: [{ role: "AirlineRepresentative", signerName: "Ana Pérez", signedAt: "2026-11-04T16:00:00.000Z" }],
    staleRoles: [], isFullySigned: false,
    summary: { flightIn: "ZZ100", flightOut: "ZZ101", registration: "HI1100", aircraftType: "A320 (A320)", position: "A01",
      passengersIn: 152, passengersOut: 149, mtowKg: 77000,
      services: [{ code: "RAMP-GPU", name: "GPU", quantity: 1.5, unit: "PerHour", amount: 180 }],
      surcharges: [], currencyCode: "USD", totalAmount: 180, milestoneCount: 3, checklistAnswered: 2, checklistTotal: 21,
      damageCount: 1 },
  }],
  damageMarks: [{ id: markId, x: 0.45, y: 0.3, note: "Abolladura", reportedAt: "2026-11-04T16:00:00.000Z", hasPhoto: false }],
};

describe("Operation documents client (ADR-0032)", () => {
  it("knows who signs each form and the shared silhouette", () => {
    expect(OPERATION_DOCUMENT_SIGNERS.ServiceOrder).toEqual(["AirlineRepresentative", "AviamAgent"]);
    expect(AIRCRAFT_SILHOUETTE.outline.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
  });

  it("signs, marks and uploads with the device headers", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), method: String(init?.method),
        headers: new Headers(init?.headers), body: init?.body });
      return Response.json(documents);
    } });
    await expect(client.getRampOperationDocuments(operationId)).resolves.toMatchObject({ documents: [{ kind: "ServiceOrder" }] });
    await client.signRampOperationDocument(operationId, "ServiceOrder", "AirlineRepresentative",
      { signerName: "  Ana   Pérez ", documentSha256: sha, strokes: [[0.12345, 0.5, 0.9, 0.25]] }, installationId, key);
    await client.recordRampDamageMark(operationId, markId, { x: 0.45, y: 0.3, note: " Abolladura ",
      reportedAt: "2026-11-04T16:00:00.000Z" }, installationId, key);
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    await client.attachRampDamagePhoto(operationId, markId, photo, "image/jpeg", installationId);
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", `/api/v1/ramp/operations/${operationId}/documents`],
      ["PUT", `/api/v1/ramp/operations/${operationId}/documents/ServiceOrder/signatures/AirlineRepresentative`],
      ["PUT", `/api/v1/ramp/operations/${operationId}/damage-marks/${markId}`],
      ["PUT", `/api/v1/ramp/operations/${operationId}/damage-marks/${markId}/photo`],
    ]);
    expect(JSON.parse(String(requests[1]!.body))).toEqual({ signerName: "Ana Pérez", documentSha256: sha,
      strokes: [[0.123, 0.5, 0.9, 0.25]] });
    expect(requests[1]!.headers.get("idempotency-key")).toBe(key);
    expect(requests[3]!.headers.get("content-type")).toBe("image/jpeg");
    expect(requests[3]!.headers.get("x-elevant-installation-id")).toBe(installationId);
    expect(requests[3]!.body).toBe(photo);
  });

  it("refuses implausible signatures and marks before calling", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => { throw new Error("must not call"); } });
    expect(normalizedSignature({ signerName: "A", documentSha256: sha, strokes: [[0.1, 0.1, 0.2, 0.2]] })).toBeNull();
    expect(normalizedSignature({ signerName: "Ana", documentSha256: sha, strokes: [[0.1, 1.4]] })).toBeNull();
    await expect(client.signRampOperationDocument(operationId, "ServiceOrder", "Coordinator",
      { signerName: "Ana", documentSha256: "nope", strokes: [[0.1, 0.1, 0.2, 0.2]] }, installationId, key))
      .rejects.toThrow(TypeError);
    await expect(client.recordRampDamageMark(operationId, markId, { x: 2, y: 0.3, note: "Abolladura",
      reportedAt: "2026-11-04T16:00:00.000Z" }, installationId, key)).rejects.toThrow(TypeError);
  });
});
