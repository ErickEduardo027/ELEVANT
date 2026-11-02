import { expect, test, type Page } from "@playwright/test";

const API = process.env.E2E_STACK_API ?? "http://127.0.0.1:18088";
const MAILPIT = process.env.E2E_STACK_MAILPIT ?? "http://127.0.0.1:8025";
const PUBLIC_API = "https://api.stack.elevant.test";
const EMAIL = "airline.client@dev.elevant.test";

/** Forwards the browser's HTTPS API name to the local API, answering CORS like the real edge. */
async function forwardApi(page: Page) {
  await page.route(`${PUBLIC_API}/**`, async route => {
    const request = route.request();
    const origin = request.headers().origin ?? "*";
    const cors = { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization,content-type,idempotency-key,x-elevant-installation-id",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS", "access-control-expose-headers": "etag" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const response = await route.fetch({ url: request.url().replace(PUBLIC_API, API) });
    await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
}

type MailpitMessage = { ID: string; To: Array<{ Address: string }>; Subject: string; Created: string };

/** Waits for the newest email to the address created after `since` whose subject matches. */
async function waitForEmail(subject: RegExp, since: number): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=50`)).json() as { messages: MailpitMessage[] };
    const match = list.messages.find(item => item.To.some(to => to.Address === EMAIL) && subject.test(item.Subject) &&
      Date.parse(item.Created) >= since);
    if (match) return ((await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json()) as { Text: string }).Text;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`No email matching ${subject} reached Mailpit.`);
}

// Requests still in flight when the test ends (SignalR, polling) must not fail it.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  test.skip(!health?.ok, "The local stack is not running.");
});

test("password recovery and the emailed login code work end to end through Mailpit", async ({ page }) => {
  await forwardApi(page);
  const password = `Stack-E2E-${Date.now()}!Aa`;

  // 1. «¿Olvidaste tu contraseña?» sends a real email with a reset link.
  const resetRequested = Date.now() - 2000;
  await page.goto("/recuperar");
  await page.getByLabel("Correo corporativo").fill(EMAIL);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByRole("status")).toContainText("Si el correo pertenece a una cuenta del portal");
  const resetEmail = await waitForEmail(/contraseña/i, resetRequested);
  const token = /token=([A-Za-z0-9_\-%]+)/.exec(resetEmail)?.[1];
  expect(token).toBeTruthy();

  // 2. The link sets the new password.
  await page.goto(`/recuperar?token=${token}`);
  await page.getByLabel("Contraseña nueva", { exact: true }).fill(password);
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText(/Contraseña actualizada/)).toBeVisible();

  // 3. The login asks for the 6-digit code sent by email.
  const loginStarted = Date.now() - 2000;
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Correo corporativo" }).fill(EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Código de verificación/ })).toBeVisible();
  const codeEmail = await waitForEmail(/código/i, loginStarted);
  const code = /^\s*(\d{6})\s*$/m.exec(codeEmail)?.[1];
  expect(code).toMatch(/^\d{6}$/);
  await page.getByRole("textbox", { name: /Código de verificación/ }).fill(code!);
  await page.getByRole("button", { name: "Verificar y entrar" }).click();

  // 4. The portal opens with the airline resolved by the real API.
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.locator("#portal-content")).toBeVisible();
  await page.goto("/portal/contratos");
  await expect(page.getByRole("heading", { name: "Permisos de la aerolínea" })).toBeVisible();
});
