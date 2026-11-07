import { describe, expect, it } from "vitest";
import { createElevantApiClient, isAirlinePortalUsers } from "../src";

// Phase 2, block E: the airline's own portal users, its representatives and its signers (2-N20).
const representativeId = "40000000-0000-7000-8000-000000000003";
const userId = "40000000-0000-7000-8000-0000000000c1";
const key = "a0000000-0000-7000-8000-0000000000e2";
const representative = { id: representativeId, firstName: "Casey", lastName: "Airline", email: "casey@demo-air.test",
  status: "Active", invitationPending: false, representative: true, signer: false,
  lastLoginAt: "2026-11-06T12:00:00.000Z", version: "AAAAAAAAB9E=" };
const user = { id: userId, firstName: "Luis", lastName: "Linares", email: "luis@demo-air.test", status: "Active",
  invitationPending: true, representative: false, signer: false, lastLoginAt: null, version: "AAAAAAAAB+E=" };
const listing = { me: { accountId: representativeId, representative: true, signer: false, canSign: true,
  canManageUsers: true }, users: [representative, user] };

type Call = { url: string; method: string; headers: Headers; body: string };

function client(answers: Response[], calls: Call[] = []) {
  return createElevantApiClient({ baseUrl: "https://api.example.test", getAccessToken: () => "token",
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers),
        body: String(init?.body ?? "") });
      return answers.shift()!;
    } });
}

const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ status, title: "Raw title", code }), {
    status, headers: { "content-type": "application/problem+json" },
  });

describe("airline portal users", () => {
  it("reads the users and the capabilities that follow from the roles", async () => {
    expect(isAirlinePortalUsers(listing)).toBe(true);
    // A representative always signs and manages; anybody else manages nobody.
    expect(isAirlinePortalUsers({ ...listing, me: { ...listing.me, canSign: false } })).toBe(false);
    expect(isAirlinePortalUsers({ ...listing, me: { ...listing.me, representative: false } })).toBe(false);
    expect(isAirlinePortalUsers({ ...listing, users: [user, user] })).toBe(false);
    expect(isAirlinePortalUsers({ ...listing, users: [{ ...user, role: "admin" }] })).toBe(false);
    const calls: Call[] = [];
    const api = client([Response.json(listing), problem(403, "forbidden")], calls);
    await expect(api.getAirlinePortalUsers()).resolves.toEqual(listing);
    expect(calls[0]!.url).toBe("https://api.example.test/api/v1/airline/portal/users");
    await expect(api.getAirlinePortalUsers()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("invites with a key, replays as 200 and explains who may manage users", async () => {
    const calls: Call[] = [];
    const api = client([Response.json(user, { status: 201 }), Response.json(user),
      Response.json({ ...user, email: "otro@demo-air.test" }, { status: 201 }), problem(403, "representative_required")], calls);
    const invite = { firstName: " Luis ", lastName: "Linares", email: " luis@demo-air.test ", signer: false };
    await expect(api.inviteAirlinePortalUser(invite, key)).resolves.toEqual(user);
    expect(calls[0]!.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body)).toEqual({ firstName: "Luis", lastName: "Linares", email: "luis@demo-air.test",
      signer: false });
    expect(calls[0]!.headers.get("idempotency-key")).toBe(key);
    await expect(api.inviteAirlinePortalUser(invite, key)).resolves.toEqual(user);
    // The answer is the user invited, never another one.
    await expect(api.inviteAirlinePortalUser(invite, key)).rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.inviteAirlinePortalUser(invite, key)).rejects.toMatchObject({ status: 403,
      code: "representative_required" });
    await expect(api.inviteAirlinePortalUser({ ...invite, email: "sin-arroba" }, key)).rejects.toThrow(TypeError);
    await expect(api.inviteAirlinePortalUser({ ...invite, firstName: "L" }, key)).rejects.toThrow(TypeError);
  });

  it("changes the status and the signer of the user of the route with the version on screen", async () => {
    const calls: Call[] = [];
    const signer = { ...user, signer: true, version: "AAAAAAAAB/E=" };
    const api = client([Response.json({ ...user, status: "Disabled" }), Response.json(signer),
      Response.json({ ...signer, id: representativeId }), problem(409, "portal_user_protected")], calls);
    await expect(api.setAirlinePortalUserStatus(userId, { isActive: false, expectedVersion: user.version }, key))
      .resolves.toMatchObject({ status: "Disabled" });
    expect(calls[0]!.url).toBe(`https://api.example.test/api/v1/airline/portal/users/${userId}/status`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ isActive: false, expectedVersion: user.version });
    await expect(api.setAirlinePortalUserSigner(userId, { signer: true, expectedVersion: user.version }, key))
      .resolves.toEqual(signer);
    expect(calls[1]!.url).toBe(`https://api.example.test/api/v1/airline/portal/users/${userId}/signer`);
    await expect(api.setAirlinePortalUserSigner(userId, { signer: true, expectedVersion: user.version }, key))
      .rejects.toMatchObject({ kind: "malformed-response" });
    await expect(api.setAirlinePortalUserSigner(representativeId, { signer: true, expectedVersion: user.version }, key))
      .rejects.toMatchObject({ status: 409, code: "portal_user_protected" });
    await expect(api.setAirlinePortalUserStatus(userId, { isActive: true, expectedVersion: "" }, key)).rejects.toThrow(TypeError);
  });
});
