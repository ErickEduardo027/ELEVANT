import { describe, expect, it } from "vitest";
import { createElevantApiClient } from "../src";

const operationId = "70000000-0000-7000-8000-000000000005";
const accountId = "10000000-0000-7000-8000-000000000005";
const messageId = "80000000-0000-7000-8000-000000000005";
const notificationId = "90000000-0000-7000-8000-000000000005";
const key = "a0000000-0000-7000-8000-000000000005";
const installationId = "b0000000-0000-7000-8000-000000000005";
const sentAt = "2026-09-24T10:00:00.000Z";
const message = { id: messageId, operationId, senderAccountId: accountId,
  senderRole: "agent", senderName: "Agente Demo", content: "Puente listo", sentAt };
const notification = { id: notificationId, operationId, operationCode: "OP-101",
  stationCode: "PUJ", kind: "chat_message", sourceId: messageId,
  occurredAt: sentAt, readAt: null };

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" },
});

describe("durable operational communication client", () => {
  it("uses canonical paths, auth and stable command headers", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
    const answers = [
      { conversations: [{ operationId, operationCode: "OP-101", operationDate: "2026-09-24",
        stationCode: "PUJ", airlineName: "Demo Air", agentName: "Agente Demo",
        status: "InProgress", lastMessage: message, unreadCount: 2, othersReadUpTo: null }], hasMore: false },
      { operationId, messages: [message], hasMore: false, othersReadUpTo: sentAt }, message,
      null,
      { notifications: [notification], hasMore: false },
      { ...notification, readAt: sentAt },
    ];
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "token", fetch: async (input, init) => {
        requests.push({ url: String(input), method: String(init?.method),
          headers: new Headers(init?.headers), body: String(init?.body ?? "") });
        const answer = answers[requests.length - 1];
        return answer === null ? new Response(null, { status: 204 }) : json(answer);
      } });
    await expect(client.getOperationalConversations()).resolves.toMatchObject({ hasMore: false });
    await expect(client.getOperationalMessages(operationId)).resolves.toMatchObject({ messages: [message] });
    await expect(client.sendOperationalMessage(operationId, { content: " Puente listo " }, key, installationId))
      .resolves.toEqual(message);
    await expect(client.markOperationalConversationRead(operationId, messageId)).resolves.toBeUndefined();
    await expect(client.getOperationalNotifications()).resolves.toMatchObject({ notifications: [notification] });
    await expect(client.setOperationalNotificationRead(notificationId, true))
      .resolves.toMatchObject({ id: notificationId, readAt: sentAt });
    expect(requests.map(item => [item.method, item.url])).toEqual([
      ["GET", "https://api.example.test/api/v1/chat/conversations"],
      ["GET", `https://api.example.test/api/v1/chat/conversations/${operationId}/messages`],
      ["POST", `https://api.example.test/api/v1/chat/conversations/${operationId}/messages`],
      ["PUT", `https://api.example.test/api/v1/chat/conversations/${operationId}/read`],
      ["GET", "https://api.example.test/api/v1/notifications"],
      ["PUT", `https://api.example.test/api/v1/notifications/${notificationId}/read`],
    ]);
    expect(requests.every(item => item.headers.get("authorization") === "Bearer token")).toBe(true);
    expect(requests[2]!.headers.get("idempotency-key")).toBe(key);
    expect(requests[2]!.headers.get("x-elevant-installation-id")).toBe(installationId);
    expect(JSON.parse(requests[2]!.body)).toEqual({ content: "Puente listo" });
    expect(JSON.parse(requests[3]!.body)).toEqual({ messageId });
    expect(JSON.parse(requests[5]!.body)).toEqual({ read: true });
  });

  it("rejects a malformed read cursor before calling the API", async () => {
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      getAccessToken: () => "token", fetch: async () => { throw new Error("must not call"); } });
    await expect(client.markOperationalConversationRead(operationId, "nope")).rejects.toThrow(TypeError);
  });

  it("rejects malformed scope, oversized content and contradictory read receipts", async () => {
    let response: unknown = { operationId: crypto.randomUUID(), messages: [message], hasMore: false };
    const client = createElevantApiClient({ baseUrl: "https://api.example.test",
      fetch: async () => json(response) });
    await expect(client.getOperationalMessages(operationId)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(client.sendOperationalMessage(operationId, { content: "x".repeat(2001) }, key))
      .rejects.toThrow(TypeError);
    response = notification;
    await expect(client.setOperationalNotificationRead(notificationId, true))
      .rejects.toMatchObject({ kind: "malformed-response" });
  });
});
