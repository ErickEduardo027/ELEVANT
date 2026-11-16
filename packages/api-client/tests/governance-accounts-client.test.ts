import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";

const requestId = "70000000-0000-7000-8000-0000000000e1";
const contractId = "71000000-0000-7000-8000-0000000000e1";
const accountId = "40000000-0000-7000-8000-0000000000e1";
const organizationId = "10000000-0000-7000-8000-0000000000e1";
const invoiceId = "72000000-0000-7000-8000-0000000000e1";
const key = "a0000000-0000-7000-8000-0000000000e1";
const version = "AAAAAAAAB9E=";
const task = {
  requestId, reference: "QA-REQ-0001", airline: "Caribe Cargo Express", representativeName: "Ana Rivera",
  suggestedEmail: "ana@caribecargo.example.com", contractId, approvedAt: "2026-11-05T12:00:00.123+00:00", version,
};
const entry = {
  id: "73000000-0000-7000-8000-0000000000e1", recipient: "ana@caribecargo.example.com", purpose: "Activation",
  status: "Discarded", attempts: 0, createdAt: "2026-11-06T10:00:00+00:00", sentAt: null,
  updatedAt: "2026-11-06T10:05:00+00:00", reason: "superseded",
  reference: { kind: "account", id: accountId, label: "Ana Rivera", context: "Caribe Cargo Express" },
};
const outbox = { smtpConfigured: false, page: 1, limit: 25, hasMore: false, entries: [entry] };
const invoiceStatus = { invoiceId, smtpConfigured: true, deliveries: [{ recipient: "billing@caribecargo.example.com",
  status: "Failed", reason: "smtp_rejected", createdAt: "2026-11-06T10:00:00Z", sentAt: null }] };

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
const problem = (status: number, code: string) => new Response(JSON.stringify({ status, title: "Raw title", code }),
  { status, headers: { "content-type": "application/problem+json" } });

describe("portal accounts and emails client", () => {
  it("lists provisioning tasks with their version and refuses unknown keys or repeated requests", async () => {
    const { api, calls } = client([Response.json([task])]);
    await expect(api.listProvisioningTasks()).resolves.toEqual([task]);
    expect(calls[0]!.url).toBe("https://api.example.test/api/v1/governance/provisioning");
    for (const malformed of [[{ ...task, password: "x" }], [{ ...task, version: "" }], [task, task]]) {
      const { api: other } = client([Response.json(malformed)]);
      await expect(other.listProvisioningTasks()).rejects.toMatchObject({ kind: "malformed-response" });
    }
  });

  it("invites by default, sends a temporary password only when chosen, and links with its own key", async () => {
    const { api, calls } = client([
      Response.json({ accountId }, { status: 201 }), Response.json({ accountId }, { status: 201 }),
      Response.json({ accountId }), problem(409, "email_in_use_other_airline"),
    ]);
    await api.provisionAirlineAccount(requestId, { email: " ana@caribecargo.example.com ", temporaryPassword: "",
      expectedVersion: version }, key);
    await api.provisionAirlineAccount(requestId, { email: "ana@caribecargo.example.com",
      temporaryPassword: "Synthetic-Temporary!2026", expectedVersion: version }, key);
    await expect(api.linkProvisioningAccount(requestId, { email: "ana@caribecargo.example.com", expectedVersion: version },
      key)).resolves.toEqual({ accountId });
    const refused = await api.linkProvisioningAccount(requestId, { email: "gsa@carrier.example.com",
      expectedVersion: version }, key).catch(error => error);
    expect(refused).toBeInstanceOf(ElevantApiError);
    expect(refused).toMatchObject({ status: 409, code: "email_in_use_other_airline" });

    expect(calls.map(call => [call.method, call.url])).toEqual([
      ["POST", `https://api.example.test/api/v1/governance/provisioning/${requestId}`],
      ["POST", `https://api.example.test/api/v1/governance/provisioning/${requestId}`],
      ["POST", `https://api.example.test/api/v1/governance/provisioning/${requestId}/account-link`],
      ["POST", `https://api.example.test/api/v1/governance/provisioning/${requestId}/account-link`],
    ]);
    expect(calls.every(call => call.headers.get("idempotency-key") === key)).toBe(true);
    expect(JSON.parse(calls[0]!.body)).toEqual({ email: "ana@caribecargo.example.com", expectedVersion: version });
    expect(JSON.parse(calls[1]!.body)).toEqual({ email: "ana@caribecargo.example.com",
      temporaryPassword: "Synthetic-Temporary!2026", expectedVersion: version });
    expect(JSON.parse(calls[2]!.body)).toEqual({ email: "ana@caribecargo.example.com", expectedVersion: version });
  });

  it("validates the commands and the answer status before trusting them", async () => {
    const { api } = client([Response.json({ accountId })]);
    await expect(api.provisionAirlineAccount(requestId, { email: "no-es-correo", expectedVersion: version }, key))
      .rejects.toThrow(TypeError);
    await expect(api.provisionAirlineAccount(requestId, { email: "ana@caribecargo.example.com", expectedVersion: "" }, key))
      .rejects.toThrow(TypeError);
    await expect(api.linkProvisioningAccount(requestId, { email: "ana@caribecargo.example.com", expectedVersion: version },
      "not-a-uuid")).rejects.toThrow(TypeError);
    // A provisioning answers 201; a 200 is not what the API promises.
    await expect(api.provisionAirlineAccount(requestId, { email: "ana@caribecargo.example.com", expectedVersion: version },
      key)).rejects.toMatchObject({ kind: "malformed-response" });
  });

  it("resends an invitation and resets a client password with the account version", async () => {
    const { api, calls } = client([Response.json({ accountId }, { status: 202 }), Response.json({ id: accountId }),
      Response.json({ id: requestId })]);
    await expect(api.resendAirlineInvitation(accountId, { expectedVersion: version }, key)).resolves.toEqual({ accountId });
    await expect(api.resetClientUserPassword(organizationId, accountId, { temporaryPassword: "Synthetic-Temporary!2026",
      expectedVersion: version }, key)).resolves.toEqual({ id: accountId });
    // The answer must be the user of the route.
    await expect(api.resetClientUserPassword(organizationId, accountId, { temporaryPassword: "Synthetic-Temporary!2026",
      expectedVersion: version }, key)).rejects.toMatchObject({ kind: "malformed-response" });
    expect(calls[0]!.url).toBe(`https://api.example.test/api/v1/governance/provisioning/accounts/${accountId}/resend-invitation`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ expectedVersion: version });
    expect(calls[1]!.url).toBe(
      `https://api.example.test/api/v1/governance/clients/${organizationId}/users/${accountId}/password-reset`);
    expect(JSON.parse(calls[1]!.body)).toEqual({ temporaryPassword: "Synthetic-Temporary!2026", expectedVersion: version });
    await expect(api.resetClientUserPassword(organizationId, accountId, { temporaryPassword: "",
      expectedVersion: version }, key)).rejects.toThrow(TypeError);
  });

  it("reads the outbox page with reasons and references and refuses anything else", async () => {
    const { api, calls } = client([Response.json(outbox), Response.json({ ...outbox, page: 2, limit: 10 })]);
    await expect(api.getEmailOutbox()).resolves.toEqual(outbox);
    await api.getEmailOutbox({ status: "Discarded", page: 2, limit: 10 });
    expect(calls.map(call => call.url)).toEqual([
      "https://api.example.test/api/v1/governance/email/outbox?status=All&page=1&limit=25",
      "https://api.example.test/api/v1/governance/email/outbox?status=Discarded&page=2&limit=10",
    ]);
    for (const malformed of [
      { ...outbox, entries: [{ ...entry, htmlBody: "<p>código</p>" }] },
      { ...outbox, entries: [{ ...entry, reason: "SmtpException: mailbox unavailable" }] },
      { ...outbox, entries: [{ ...entry, status: "Lost" }] },
      { ...outbox, entries: [{ ...entry, reference: { ...entry.reference, kind: "secret" } }] },
      { ...outbox, page: 2 },
      { ...outbox, total: 1 },
    ]) {
      const { api: other } = client([Response.json(malformed)]);
      await expect(other.getEmailOutbox()).rejects.toMatchObject({ kind: "malformed-response" });
    }
    // A filtered page lists that status only.
    const { api: filtered } = client([Response.json(outbox)]);
    await expect(filtered.getEmailOutbox({ status: "Pending" })).rejects.toMatchObject({ kind: "malformed-response" });
    const { api: local } = client([]);
    for (const query of [{ status: "Lost" }, { page: 0 }, { limit: 51 }, { limit: 1.5 }])
      await expect(local.getEmailOutbox(query as never)).rejects.toThrow(TypeError);
  });

  it("reads the email status of the invoice it asked for", async () => {
    const { api, calls } = client([Response.json(invoiceStatus), Response.json({ ...invoiceStatus, invoiceId: requestId }),
      Response.json({ ...invoiceStatus, deliveries: [{ ...invoiceStatus.deliveries[0], status: "Bounced" }] })]);
    await expect(api.getInvoiceEmailDeliveries(invoiceId)).resolves.toEqual(invoiceStatus);
    expect(calls[0]!.url).toBe(`https://api.example.test/api/v1/finance/invoices/${invoiceId}/email-deliveries`);
    await expect(api.getInvoiceEmailDeliveries(invoiceId)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.getInvoiceEmailDeliveries(invoiceId)).rejects.toMatchObject({ kind: "malformed-response" });
  });
});
