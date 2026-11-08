import { describe, expect, it } from "vitest";
import { createElevantApiClient, FLIGHT_REPORT_MILESTONES, IATA_DELAY_CODES } from "../src";

const operationId = "70000000-0000-7000-8000-000000000005";
const installationId = "81000000-0000-7000-8000-000000000071";
const key = "82000000-0000-7000-8000-000000000071";
const execution = { receiptId: "83000000-0000-7000-8000-000000000071", operationId,
  milestones: [{ code: "BLOCK_ON", actualAt: "2026-11-04T16:00:00.000Z" }],
  passengersIn: 150, passengersOut: 148, mtowKg: 78000, aircraftRegistration: "HI1099" };

describe("Flight Report client (ADR-0031)", () => {
  it("mirrors the form: 25 milestones in four phases and IATA delay codes", () => {
    expect(FLIGHT_REPORT_MILESTONES).toHaveLength(25);
    expect(new Set(FLIGHT_REPORT_MILESTONES.map(item => item.phase))).toEqual(new Set(["arrival", "on_stand", "departure", "pushback"]));
    expect(IATA_DELAY_CODES.every(item => /^\d{2}$/.test(item.code))).toBe(true);
  });

  it("records milestones and flight data with the device headers", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input).replace("https://api.example.test", ""), method: String(init?.method),
        headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return Response.json(execution);
    } });
    await expect(client.recordRampMilestone(operationId, "BLOCK_ON", "2026-11-04T16:00:00.000Z", installationId, key))
      .resolves.toMatchObject({ milestones: [{ code: "BLOCK_ON" }] });
    await client.updateRampFlightData(operationId, { passengersIn: 150, passengersOut: 148, mtowKg: 78000,
      aircraftRegistration: " hi1099 " }, installationId, key);
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["PUT", `/api/v1/ramp/operations/${operationId}/milestones/BLOCK_ON`],
      ["PUT", `/api/v1/ramp/operations/${operationId}/flight-data`],
    ]);
    expect(requests[0]!.headers.get("idempotency-key")).toBe(key);
    expect(requests[0]!.headers.get("x-elevant-installation-id")).toBe(installationId);
    expect(JSON.parse(requests[1]!.body)).toEqual({ passengersIn: 150, passengersOut: 148, mtowKg: 78000,
      aircraftRegistration: "HI1099" });
  });

  it("sends the aircraft type only when the tablet has one, so an older command keeps its receipt hash (3-B)", async () => {
    const bodies: string[] = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (_input, init) => {
      bodies.push(String(init?.body ?? ""));
      return Response.json(execution);
    } });
    const typeId = "60000000-0000-7000-8000-000000000001";
    await client.updateRampFlightData(operationId, { passengersIn: 150, passengersOut: 148, mtowKg: 78000,
      aircraftRegistration: null, aircraftTypeId: typeId }, installationId, key);
    await client.updateRampFlightData(operationId, { passengersIn: 150, passengersOut: 148, mtowKg: 78000,
      aircraftRegistration: null, aircraftTypeId: null }, installationId, key);
    expect(JSON.parse(bodies[0]!)).toEqual({ passengersIn: 150, passengersOut: 148, mtowKg: 78000, aircraftRegistration: null,
      aircraftTypeId: typeId });
    expect(Object.keys(JSON.parse(bodies[1]!))).toEqual(["passengersIn", "passengersOut", "mtowKg", "aircraftRegistration"]);
    await expect(client.updateRampFlightData(operationId, { passengersIn: null, passengersOut: null, mtowKg: null,
      aircraftRegistration: null, aircraftTypeId: "A320" }, installationId, key)).rejects.toThrow(TypeError);
    expect(bodies).toHaveLength(2);
  });

  it("rejects unknown codes, impossible data and deviations without a delay code before calling", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => { throw new Error("must not call"); } });
    await expect(client.recordRampMilestone(operationId, "TAKE_OFF", "2026-11-04T16:00:00.000Z", installationId, key))
      .rejects.toThrow(TypeError);
    await expect(client.updateRampFlightData(operationId, { passengersIn: 1000, passengersOut: null, mtowKg: null,
      aircraftRegistration: null }, installationId, key)).rejects.toThrow(TypeError);
    await expect(client.reportRampIncident(operationId, { incidentType: "Deviation", severity: "Medium",
      description: "GPU tarde en la posición", occurredAt: "2026-11-04T16:00:00.000Z" }, installationId, key))
      .rejects.toThrow(TypeError);
  });
});
