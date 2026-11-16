import { expect, test } from "@playwright/test";
import { E2E_LOGIN_CODE, stubAirlineApi } from "./airline-api";

// Second teacher review, against the stubbed API: email code at login, activation and
// recovery links, the permit dossier and the printable contract (ADR-0022, ADR-0024).

test("portal login asks for the emailed code, resends it and enters with the right one", async ({ page }) => {
  const paths = await stubAirlineApi(page, { codeRequired: true });
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Correo corporativo" }).fill("airline.client@dev.elevant.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("Synthetic-Password!2026");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();

  const code = page.getByRole("textbox", { name: /Código de verificación/ });
  await expect(code).toBeVisible();
  await expect(page.getByText("a••••t@dev.elevant.test", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reenviar código en \d+ s/ })).toBeDisabled();

  await code.fill("111111");
  await page.getByRole("button", { name: "Verificar y entrar" }).click();
  await expect(page.locator("#login-panel").getByRole("alert")).toContainText("no es válido o ya venció");

  await code.fill(E2E_LOGIN_CODE);
  await page.getByRole("button", { name: "Verificar y entrar" }).click();
  await expect(page).toHaveURL(/\/portal$/);
  expect(paths).toContain("POST /api/v1/auth/session/verify-code");
});

test("activation link sets the first password and recovery answers the same for any email", async ({ page }) => {
  await stubAirlineApi(page);
  await page.goto("/activar?token=aB3-dE5_fG7hI9jK1lM3nO5pQ7rS9tU1");
  await expect(page.getByRole("heading", { name: "Crea la contraseña de tu cuenta." })).toBeVisible();
  await page.getByLabel("Contraseña nueva", { exact: true }).fill("Synthetic-Activated!2026");
  await page.getByLabel("Confirmar contraseña", { exact: true }).fill("Synthetic-Activated!2026");
  await page.getByRole("button", { name: "Activar cuenta" }).click();
  await expect(page.getByText(/Cuenta activada/)).toBeVisible();
  await page.getByRole("link", { name: "Ir a iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page).toHaveURL(/\/recuperar$/);
  await page.getByLabel("Correo corporativo").fill("nadie@example.test");
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByRole("status")).toContainText("Si el correo pertenece a una cuenta del portal");
});

test("the airline submits a permit and downloads its contract as PDF", async ({ page }) => {
  await stubAirlineApi(page);
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Correo corporativo" }).fill("airline.client@dev.elevant.test");
  await page.getByLabel("Contraseña", { exact: true }).fill("Synthetic-Password!2026");
  await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/portal$/);
  await page.goto("/portal/contratos");

  await expect(page.getByText("Falta un permiso de operación verificado")).toBeVisible();
  await page.getByLabel("Número").fill("JAC-2026-002");
  await page.getByLabel("Emisor").fill("Junta de Aviación Civil");
  await page.getByLabel("Fecha de emisión").fill("2026-10-01");
  await page.getByLabel("Fecha de vencimiento").fill("2099-01-01");
  await page.getByRole("button", { name: "Enviar permiso" }).click();
  await expect(page.getByText(/Permiso enviado/)).toBeVisible();
  await expect(page.getByText(/En revisión por AVIAM/)).toBeVisible();

  const documentGroup = page.getByRole("group", { name: "Documento: contrato firmable" });
  const download = page.waitForEvent("download");
  await documentGroup.getByRole("button", { name: "Descargar PDF" }).click();
  expect((await download).suggestedFilename()).toBe("contrato-DEV-CONTRACT-0001-v1.pdf");
  await expect(documentGroup.getByRole("button", { name: "Imprimir" })).toBeEnabled();

  await page.getByRole("button", { name: "Ver línea de tiempo del contrato" }).click();
  await expect(page.getByRole("list", { name: /Línea de tiempo de DEV-CONTRACT-0001/ })).toContainText("Contrato activo");
});
