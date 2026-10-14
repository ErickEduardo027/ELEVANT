import { expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),
  { status, headers: { "content-type": "application/json" } });
const QUALIFICATION_ID = "50000000-0000-7000-8000-000000000012";
const PERMIT_ID = "50000000-0000-7000-8000-000000000013";

function clientFor(handler: (url: string, init?: RequestInit) => Response) {
  const urls: string[] = [];
  const client = createElevantApiClient({ baseUrl: "https://api.example.test",
    fetch: async (url, init) => { urls.push(String(url)); return handler(String(url), init); } });
  return { client, urls };
}

const summary = { asOf: "2026-10-13", expiringSoonDays: 30, total: 4, valid: 1,
  expiringSoon: 1, expired: 1, upcoming: 1 };

it("reads document summaries with filters and rejects inconsistent counts", async () => {
  const { client, urls } = clientFor(() => json(summary));
  await expect(client.getHumanResourcesQualificationSummary({ asOf: "2026-10-13",
    search: "  Riley  ", equipmentTypeId: "20000000-0000-7000-8000-000000000007" }))
    .resolves.toEqual(summary);
  await expect(client.getHumanResourcesPermitSummary({ asOf: "2026-10-13",
    documentType: "AirportId" })).resolves.toEqual(summary);
  expect(urls).toEqual([
    "https://api.example.test/api/v1/human-resources/qualifications/summary?equipmentTypeId=20000000-0000-7000-8000-000000000007&search=Riley&asOf=2026-10-13",
    "https://api.example.test/api/v1/human-resources/permits/summary?documentType=AirportId&asOf=2026-10-13",
  ]);
  await expect(client.getHumanResourcesPermitSummary({ documentType: "Passport" } as never))
    .rejects.toBeInstanceOf(TypeError);
  const broken = clientFor(() => json({ ...summary, total: 5 })).client;
  await expect(broken.getHumanResourcesQualificationSummary())
    .rejects.toMatchObject({ kind: "malformed-response" });
  const otherDay = clientFor(() => json({ ...summary, asOf: "2026-10-12" })).client;
  await expect(otherDay.getHumanResourcesQualificationSummary({ asOf: "2026-10-13" }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("reads qualification history newest first and requires the requested cycle", async () => {
  const history = {
    rampProfileId: "50000000-0000-7000-8000-000000000001", agentName: "Riley Ramp",
    employeeNumber: "DEV-RA-001", equipmentTypeId: "20000000-0000-7000-8000-000000000007",
    equipmentCode: "GPU", equipmentName: "Ground power unit",
    cycles: [
      { id: QUALIFICATION_ID, cycleNumber: 2, isCurrent: true, trainingDate: "2026-09-01",
        obtainedOn: "2026-09-02", expiresOn: "2027-09-02", certifyingEntity: "Synthetic Center",
        instructorName: "Instructor", notes: "Renewal", recordedAt: "2026-09-02T10:00:00.000+00:00",
        recordedByName: "Camila Development" },
      { id: "50000000-0000-7000-8000-000000000002", cycleNumber: 1, isCurrent: false,
        trainingDate: "2026-01-02", obtainedOn: "2026-01-03", expiresOn: "2026-09-30",
        certifyingEntity: "Synthetic Center", instructorName: "Instructor", notes: null,
        recordedAt: "2026-01-03T10:00:00.000+00:00", recordedByName: null },
    ],
  };
  const { client, urls } = clientFor(() => json(history));
  await expect(client.getHumanResourcesQualificationHistory(QUALIFICATION_ID)).resolves.toEqual(history);
  expect(urls[0]).toBe(`https://api.example.test/api/v1/human-resources/qualifications/${QUALIFICATION_ID}/history`);
  await expect(client.getHumanResourcesQualificationHistory("bad")).rejects.toBeInstanceOf(TypeError);

  const reordered = clientFor(() => json({ ...history, cycles: [...history.cycles].reverse() })).client;
  await expect(reordered.getHumanResourcesQualificationHistory(QUALIFICATION_ID))
    .rejects.toMatchObject({ kind: "malformed-response" });
  const twoCurrent = clientFor(() => json({ ...history,
    cycles: history.cycles.map(cycle => ({ ...cycle, isCurrent: true })) })).client;
  await expect(twoCurrent.getHumanResourcesQualificationHistory(QUALIFICATION_ID))
    .rejects.toMatchObject({ kind: "malformed-response" });
  await expect(client.getHumanResourcesQualificationHistory("50000000-0000-7000-8000-000000000099"))
    .rejects.toMatchObject({ kind: "malformed-response" });
  const missing = clientFor(() => json({ title: "Qualification not found.", status: 404 }, 404)).client;
  await expect(missing.getHumanResourcesQualificationHistory(QUALIFICATION_ID))
    .rejects.toMatchObject({ kind: "http", status: 404 });
});

it("reads permit history for one document type", async () => {
  const history = {
    rampProfileId: "50000000-0000-7000-8000-000000000001", agentName: "Riley Ramp",
    employeeNumber: "DEV-RA-001", documentType: "AirportId",
    cycles: [{ id: PERMIT_ID, cycleNumber: 1, isCurrent: true, documentNumber: "DEV-AIRPORT-ID",
      issuedOn: "2026-01-01", expiresOn: "2099-12-31", recordedAt: "2026-01-01T10:00:00.000+00:00",
      recordedByName: null }],
  };
  const { client } = clientFor(() => json(history));
  await expect(client.getHumanResourcesPermitHistory(PERMIT_ID)).resolves.toEqual(history);
  const wrongType = clientFor(() => json({ ...history, documentType: "Passport" })).client;
  await expect(wrongType.getHumanResourcesPermitHistory(PERMIT_ID))
    .rejects.toMatchObject({ kind: "malformed-response" });
});

it("cancels a pending availability request and expects the cancelled status", async () => {
  const id = "60000000-0000-7000-8000-000000000001";
  let body = "";
  const { client } = clientFor((_url, init) => { body = String(init?.body); return json({ id, status: "Cancelled" }); });
  await expect(client.resolveHumanResourcesAvailabilityRequest(id, { decision: "Cancel", note: " Withdrawn " }))
    .resolves.toEqual({ id, status: "Cancelled" });
  expect(JSON.parse(body)).toEqual({ decision: "Cancel", note: "Withdrawn" });
  const approved = clientFor(() => json({ id, status: "Approved" })).client;
  await expect(approved.resolveHumanResourcesAvailabilityRequest(id, { decision: "Cancel", note: null }))
    .rejects.toMatchObject({ kind: "malformed-response" });
});
