import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const stationId = "20000000-0000-7000-8000-000000000001";
const turnaroundId = "30000000-0000-7000-8000-000000000001";
const standId = "20000000-0000-7000-8000-000000000005";
const turnaround = { turnaroundId, operationCode: "DEV-TAT-0001", airlineName: "Demo Airlines", aircraftRegistration: "HI1055",
  arrivalFlightNumber: "ZZ101", departureFlightNumber: "ZZ102", arrivalScheduledAt: "2026-08-18T12:00:00.000Z",
  arrivedAt: "2026-08-18T12:05:00.000Z", departureScheduledAt: "2026-08-18T14:00:00.000Z",
  assignedFrom: "2026-08-18T11:00:00.000Z", status: "InProgress" };
const board = { stationId, stationCode: "PUJ", operationDate: "2026-08-18", asOf: "2026-08-18T12:06:00.000Z", canAssign: true,
  positions: [{ standId, code: "A01", terminalCode: "A", standType: "Contact", status: "occupied", turnarounds: [turnaround] }],
  unassigned: [] };

describe("OCC positions client", () => {
  it("reads the board and sends arrival, assignment and release commands", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      return Response.json(board);
    } });
    await expect(client.getOccPositions(stationId, "2026-08-18")).resolves.toMatchObject({ stationCode: "PUJ" });
    await client.recordOccArrival(turnaroundId, { aircraftRegistration: " hi1055 " });
    await client.assignOccStand(turnaroundId, { standId, reason: "  " });
    await client.releaseOccStand(turnaroundId);
    expect(requests.map(item => [item.method, item.url.replace("https://api.example.test", "")])).toEqual([
      ["GET", `/api/v1/occ/positions?stationId=${stationId}&date=2026-08-18`],
      ["POST", `/api/v1/occ/turnarounds/${turnaroundId}/arrival`],
      ["POST", `/api/v1/occ/turnarounds/${turnaroundId}/stand`],
      ["POST", `/api/v1/occ/turnarounds/${turnaroundId}/stand/release`],
    ]);
    expect(JSON.parse(requests[1]!.body)).toEqual({ aircraftRegistration: "HI1055", arrivedAt: null });
    expect(JSON.parse(requests[2]!.body)).toEqual({ standId, reason: null });
  });

  it("rejects invalid registrations and unknown stand states", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => Response.json({ ...board, positions: [{ ...board.positions[0], status: "parked" }] }) });
    await expect(client.recordOccArrival(turnaroundId, { aircraftRegistration: "HI 1055!" })).rejects.toThrow(TypeError);
    await expect(client.getOccPositions(stationId, "2026-08-18")).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
