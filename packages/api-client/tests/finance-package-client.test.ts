import { describe, expect, it } from "vitest";
import { createElevantApiClient, ElevantApiError } from "../src";
import { ELEVANT_API_ERROR_CODES } from "../src/errors";

const versionId = "70000000-0000-7000-8000-0000000000c3";
const amendmentId = "70000000-0000-7000-8000-0000000000c4";
const packageId = "78000000-0000-7000-8000-0000000000c1";
const key = "a0000000-0000-7000-8000-0000000000c3";
const version = "AAAAAAAAB9E=";

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
const answer = (id: string, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ id, ...extra }), { status, headers: { "content-type": "application/json" } });
const problem = (status: number, code: string) => new Response(JSON.stringify({ title: "Spanish title", status, code }),
  { status, headers: { "content-type": "application/problem+json" } });

describe("finance package and amendment client", () => {
  it("amends a contract with its key, the status on screen and the start, and answers the new draft", async () => {
    const { api, calls } = client([answer(amendmentId, 201)]);
    await expect(api.createContractAmendment(versionId, { expectedStatus: "Active", validFrom: "2026-09-01" }, key))
      .resolves.toEqual({ id: amendmentId });
    expect(calls).toHaveLength(1);
    expect([calls[0]!.method, calls[0]!.url]).toEqual(["POST",
      `https://api.example.test/api/v1/contracts/versions/${versionId}/amendments`]);
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token");
    expect(JSON.parse(calls[0]!.body)).toEqual({ expectedStatus: "Active", validFrom: "2026-09-01" });
  });

  it("refuses amendments the server never accepts before any request", async () => {
    const { api, calls } = client([]);
    for (const command of [
      { expectedStatus: "Unknown", validFrom: "2026-09-01" },
      { expectedStatus: "Active", validFrom: "01/09/2026" },
      { expectedStatus: "Active", validFrom: "2026-09-01", validTo: "2026-12-31" },
    ])
      // @ts-expect-error the shapes are wrong on purpose
      await expect(api.createContractAmendment(versionId, command, key)).rejects.toBeInstanceOf(TypeError);
    await expect(api.createContractAmendment(versionId, { expectedStatus: "Active", validFrom: "2026-09-01" }, "nope"))
      .rejects.toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(0);
  });

  it("refuses an amendment answer with another status or extra keys", async () => {
    for (const malformed of [answer(amendmentId, 200), answer(amendmentId, 201, { versionNumber: 2 }), answer("x", 201)]) {
      const { api } = client([malformed]);
      await expect(api.createContractAmendment(versionId, { expectedStatus: "Suspended", validFrom: "2026-09-01" }, key))
        .rejects.toMatchObject({ kind: "malformed-response" });
    }
  });

  it.each(["discard", "retire"] as const)("sends the %s of a package with a trimmed reason and the version", async command => {
    const { api, calls } = client([answer(packageId, 200)]);
    const send = command === "discard" ? api.discardFinancePackage : api.retireFinancePackage;
    await expect(send(packageId, { expectedVersion: version, reason: "  Precio publicado por error.  " }, key))
      .resolves.toEqual({ id: packageId });
    expect([calls[0]!.method, calls[0]!.url]).toEqual(["POST",
      `https://api.example.test/api/v1/finance/packages/${packageId}/${command}`]);
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    expect(JSON.parse(calls[0]!.body)).toEqual({ expectedVersion: version, reason: "Precio publicado por error." });

    const { api: other } = client([answer(amendmentId, 200)]);
    const sendOther = command === "discard" ? other.discardFinancePackage : other.retireFinancePackage;
    await expect(sendOther(packageId, { expectedVersion: version, reason: "Precio publicado por error." }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    for (const invalid of [{ expectedVersion: version, reason: "no" }, { expectedVersion: "not a version!", reason: "Motivo válido." }])
      await expect(send(packageId, invalid, key)).rejects.toBeInstanceOf(TypeError);
  });

  it("keeps the codes of a blocked command so the screens explain them", async () => {
    for (const [status, code] of [[409, "package_retired"], [409, "package_not_published"], [409, "draft_in_progress"],
      [409, "valid_from_after_current_end"], [409, "contract_not_amendable"], [400, "reason_required"]] as const) {
      const { api } = client([problem(status, code)]);
      const failure = await api.retireFinancePackage(packageId, { expectedVersion: version, reason: "Precio publicado por error." },
        key).catch(error => error);
      expect(failure).toBeInstanceOf(ElevantApiError);
      expect(failure).toMatchObject({ status, code });
    }
  });

  it("lists the Finance codes once", () => {
    for (const code of ["package_retired", "package_not_draft", "billing_unit_unknown", "tariff_start_not_after_current",
      "draft_in_progress", "contract_not_amendable", "invalid_finance_data"])
      expect(ELEVANT_API_ERROR_CODES.filter(item => item === code)).toHaveLength(1);
  });

  it("accepts a retired package among the causes of a draft that is not ready", async () => {
    const readiness = { versionId, version, versionStatus: "Draft", ready: false, portalAccount: "Active",
      issues: [{ code: "package_retired", subjects: ["PKG-TURN v3"] }] };
    const { api } = client([Response.json(readiness)]);
    await expect(api.getContractDraftReadiness(versionId)).resolves.toEqual(readiness);
  });
});
