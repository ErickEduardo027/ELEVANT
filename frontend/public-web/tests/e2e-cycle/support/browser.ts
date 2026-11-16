import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { login } from "./api";
import { API, emailOf, passwordOf, PRIVATE_WEB, PUBLIC_API, PUBLIC_WEB, type Role, SHOTS_DIR } from "./env";
import { emailIds, loginCode, waitForEmail } from "./mailpit";

/** Node's WebSocket (undici) also takes request headers, which the DOM typing does not declare. */
const NodeWebSocket = WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** Forwards the apps' HTTPS API name to the local API and answers CORS like the real edge. */
export async function forwardApi(page: Page) {
  await page.route(`${PUBLIC_API}/**`, async route => {
    const request = route.request();
    const origin = request.headers().origin ?? "*";
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "authorization,content-type,idempotency-key,if-match,x-elevant-installation-id,x-requested-with",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-expose-headers": "etag,content-disposition,x-content-sha256",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    try {
      const response = await route.fetch({ url: request.url().replace(PUBLIC_API, API) });
      if (response.status() >= 400) {
        // Evidence for the walkthrough: what the API rejected (Problem Details never carry secrets).
        const problem = await response.json().catch(() => null) as { code?: string; title?: string } | null;
        console.warn(`[api] ${request.method()} ${new URL(request.url()).pathname} → ${response.status()}` +
          ` ${problem?.code ?? ""} ${problem?.title ?? ""}`.trimEnd());
      }
      await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
    } catch {
      await route.abort("failed").catch(() => undefined);
    }
  });
  // SignalR hubs (ADR realtime: they only announce changes): bridge the page's WebSocket to the
  // local API from Node, with the page's origin so the API's hub origin guard accepts it.
  const publicSocket = PUBLIC_API.replace(/^https/, "wss");
  const apiSocket = API.replace(/^http/, "ws");
  await page.routeWebSocket(url => url.href.startsWith(publicSocket), route => {
    const server = new NodeWebSocket(route.url().replace(publicSocket, apiSocket),
      { headers: { origin: new URL(page.url()).origin } });
    server.binaryType = "arraybuffer";
    // Node Buffers become plain bytes for the WebSocket API.
    const frame = (message: string | Buffer) => (typeof message === "string" ? message : Uint8Array.from(message));
    const pending: Array<string | Uint8Array<ArrayBuffer>> = [];
    server.onopen = () => { for (const message of pending.splice(0)) server.send(message); };
    server.onmessage = event => route.send(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer));
    server.onclose = event => {
      void route.close({ code: event.code >= 3000 || event.code === 1000 ? event.code : 1000, reason: event.reason })
        .catch(() => undefined);
    };
    route.onMessage(message => {
      if (server.readyState === WebSocket.OPEN) server.send(frame(message)); else pending.push(frame(message));
    });
    route.onClose(() => { try { server.close(); } catch { /* already closed */ } });
  });
}

let shot = 0;
/** Saves a full-page screenshot for the walkthrough report (never includes typed passwords). */
export async function snap(page: Page, name: string) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  shot += 1;
  await page.screenshot({ path: path.join(SHOTS_DIR, `${String(shot).padStart(3, "0")}-${name}.png`), fullPage: true });
}

/** Signs a seeded internal account into private-web. The API settles a forced password change first. */
export async function loginPrivate(page: Page, role: Role) {
  await login(role);
  await forwardApi(page);
  if (page.url().startsWith(PRIVATE_WEB)) {
    // The test switches roles: drop the previous session, or /login sends it back to that role's shell.
    await page.evaluate(() => { window.localStorage.clear(); window.sessionStorage.clear(); });
    await page.context().clearCookies();
  }
  await page.goto(`${PRIVATE_WEB}/login`);
  await page.fill("#elv-email", emailOf(role));
  await page.fill("#elv-pass", passwordOf(emailOf(role)));
  await page.click("button[type=submit]");
  await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 60_000 });
}

/** Signs an airline account into the public portal, reading the emailed 6-digit code from Mailpit. */
export async function loginPortal(page: Page, email: string) {
  await forwardApi(page);
  await page.goto(`${PUBLIC_WEB}/login`);
  await page.getByRole("textbox", { name: "Correo corporativo" }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(passwordOf(email));
  const earlier = await emailIds(email, /código/i);
  const since = Date.now();
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  const codeBox = page.getByRole("textbox", { name: /Código de verificación/ });
  await codeBox.waitFor({ timeout: 60_000 });
  await codeBox.fill(loginCode(await waitForEmail(email, /código/i, since, undefined, earlier)));
  await page.getByRole("button", { name: "Verificar y entrar" }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 60_000 });
}

/** Opens a private-web module from the sidebar by its visible label. */
export async function openModule(page: Page, label: string | RegExp) {
  const item = page.getByRole("navigation").getByRole("button", { name: label }).first();
  await item.click();
}

/** Opens a private-web route in the signed-in tab (the session lives in sessionStorage). */
export async function goPrivate(page: Page, route: string) {
  await page.goto(`${PRIVATE_WEB}${route}`);
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

/** Draws a signature with the mouse on a SignaturePad canvas (ADR-0025), like a person would. */
export async function drawSignature(page: Page, canvas: Locator) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The signature pad is not visible.");
  const at = (x: number, y: number) => [box.x + box.width * x, box.y + box.height * y] as const;
  await page.mouse.move(...at(0.12, 0.62));
  await page.mouse.down();
  for (const [x, y] of [[0.2, 0.3], [0.28, 0.7], [0.36, 0.35], [0.46, 0.66], [0.56, 0.4], [0.68, 0.6], [0.82, 0.45]])
    await page.mouse.move(...at(x, y), { steps: 6 });
  await page.mouse.up();
}
