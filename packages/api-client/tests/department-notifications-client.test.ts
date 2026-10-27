import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const notificationId = "90000000-0000-7000-8000-000000000011";
const sourceId = "80000000-0000-7000-8000-000000000011";
const occurredAt = "2026-10-26T10:00:00.000Z";
const notification = { id: notificationId, department: "Contracts", kind: "commercial_request", sourceId,
  subject: "Demo Air", stationCode: null, occurredAt, readAt: null };

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" },
});

describe("department notifications client", () => {
  it("lists the department feed and acknowledges one alert", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const answers = [{ notifications: [notification], unreadCount: 1, hasMore: false }, { ...notification, readAt: occurredAt }];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
      fetch: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        return json(answers.shift());
      } });
    await expect(client.getDepartmentNotifications()).resolves.toMatchObject({ unreadCount: 1, notifications: [notification] });
    await expect(client.setDepartmentNotificationRead(notificationId, true)).resolves.toMatchObject({ readAt: occurredAt });
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", "https://api.example.test/api/v1/department-notifications"],
      ["PUT", `https://api.example.test/api/v1/department-notifications/${notificationId}/read`],
    ]);
    expect(JSON.parse(requests[1]!.body)).toEqual({ read: true });
  });

  it("rejects unknown departments, negative counters and contradictory receipts", async () => {
    let response: unknown = { notifications: [{ ...notification, department: "Marketing" }], unreadCount: 1, hasMore: false };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test", fetch: async () => json(response) });
    await expect(client.getDepartmentNotifications()).rejects.toMatchObject({ kind: "malformed-response" });
    response = { notifications: [], unreadCount: -1, hasMore: false };
    await expect(client.getDepartmentNotifications()).rejects.toMatchObject({ kind: "malformed-response" });
    response = notification;
    await expect(client.setDepartmentNotificationRead(notificationId, true)).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
