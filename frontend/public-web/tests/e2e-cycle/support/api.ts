import { API, emailOf, nextPassword, passwordOf, type Role, savePassword } from "./env";
import { emailIds, loginCode, waitForEmail } from "./mailpit";

export type ApiResult<T = unknown> = { status: number; data: T; etag: string | null; headers: Headers };

/** Calls the real API from Node. Mutating calls get a fresh Idempotency-Key unless one is given. */
export async function call<T = unknown>(token: string | null, method: string, route: string, body?: unknown,
  headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const mutating = method !== "GET";
  const response = await fetch(`${API}/api/v1${route}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(mutating && !Object.keys(headers).some(key => key.toLowerCase() === "idempotency-key")
        ? { "idempotency-key": crypto.randomUUID() } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await response.json().catch(() => null)
    : type.includes("pdf") ? Buffer.from(await response.arrayBuffer()) : await response.text();
  return { status: response.status, data: data as T, etag: response.headers.get("etag"), headers: response.headers };
}

type SessionResponse = { accessToken?: string; challengeId?: string; code?: string };

/**
 * Signs in like a client would: settles a forced password change (A5, the seed never rewrites it)
 * and completes the emailed login code of portal accounts. Never prints a credential.
 */
export async function login(who: Role | { email: string }): Promise<string> {
  const email = typeof who === "string" ? emailOf(who) : who.email;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const password = passwordOf(email);
    const earlier = await emailIds(email, /código|code/i);
    const since = Date.now();
    const response = await call<SessionResponse>(null, "POST", "/auth/session", { email, password });
    if (response.status === 200 && response.data.accessToken) return response.data.accessToken;
    if (response.status === 202 && response.data.challengeId) {
      const code = loginCode(await waitForEmail(email, /código|code/i, since, undefined, earlier));
      const verified = await call<SessionResponse>(null, "POST", "/auth/session/verify-code",
        { challengeId: response.data.challengeId, code });
      if (verified.status === 200 && verified.data.accessToken) return verified.data.accessToken;
      throw new Error(`Login code for ${email} was rejected (HTTP ${verified.status}).`);
    }
    if (response.status === 409 && response.data.code === "password_change_required") {
      const changed = nextPassword(password);
      const result = await call(null, "POST", "/auth/password-change",
        { email, currentPassword: password, newPassword: changed });
      if (result.status !== 204 && result.status !== 200)
        throw new Error(`Password change for ${email} failed (HTTP ${result.status}).`);
      savePassword(email, changed);
      continue;
    }
    throw new Error(`Login for ${email} failed (HTTP ${response.status}).`);
  }
  throw new Error(`Login for ${email} did not settle.`);
}

/** Like call(), but fails the step with the status and Problem Details when it is not expected. */
export async function expectCall<T = unknown>(expected: number | number[], token: string | null, method: string,
  route: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResult<T>> {
  const result = await call<T>(token, method, route, body, headers);
  const ok = Array.isArray(expected) ? expected.includes(result.status) : result.status === expected;
  if (!ok) throw new Error(`${method} ${route} → HTTP ${result.status} ${JSON.stringify(result.data).slice(0, 400)}`);
  return result;
}
