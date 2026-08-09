import { expect, test } from "@playwright/test";

import {
  MOCK_ACCOUNTS_STORAGE_KEY,
  MOCK_PERSISTENT_SESSION_KEY,
  MOCK_TRANSIENT_SESSION_KEY,
} from "../../src/lib/mock-auth";

test.describe("acceso mock de aerolíneas", () => {
  test("mantiene el login completo en escritorios de poca altura", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "La regresión corresponde al encuadre de escritorio.",
    );

    await page.setViewportSize({ width: 1536, height: 696 });
    await page.goto("/login");

    await expect(
      page.getByRole("button", { name: "Iniciar sesión", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: /Usar credenciales de demostración/i }),
    ).toBeInViewport();
    await expect(
      page.getByText(/No concede acceso a un portal productivo/i),
    ).toBeInViewport();

    const viewport = await page.evaluate(() => ({
      height: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.height);
  });

  test("expone tabs navegables y dirige el foco al primer error", async ({
    page,
  }) => {
    await page.goto("/login");

    const loginTab = page.getByRole("tab", {
      name: "Iniciar sesión",
      exact: true,
    });
    const registerTab = page.getByRole("tab", {
      name: "Registrar aerolínea",
      exact: true,
    });

    await expect(loginTab).toHaveAttribute("aria-selected", "true");
    await loginTab.focus();
    await loginTab.press("ArrowRight");
    await expect(registerTab).toBeFocused();
    await expect(registerTab).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/\/login\?mode=register$/);

    await registerTab.press("Home");
    await expect(loginTab).toBeFocused();
    await expect(page).toHaveURL(/\/login\?mode=login$/);

    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();

    const email = page.getByRole("textbox", {
      name: "Correo corporativo",
      exact: true,
    });
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toHaveCount(2);
  });

  test("inicia y cierra una sesión con las credenciales demo sin transmitir datos", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const writeRequests: Array<{ method: string; url: string }> = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method())) {
        writeRequests.push({ method: request.method(), url: request.url() });
      }
    });

    await page
      .getByRole("button", { name: /Usar credenciales de demostración/i })
      .click();
    await page
      .getByRole("button", { name: "Iniciar sesión", exact: true })
      .click();

    await expect(
      page.getByRole("status").filter({ hasText: "Sesión demostrativa activa" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login(?:\?mode=login)?$/);

    const storage = await page.evaluate(
      ({ transientKey, persistentKey }) => ({
        transient: window.sessionStorage.getItem(transientKey),
        persistent: window.localStorage.getItem(persistentKey),
      }),
      {
        transientKey: MOCK_TRANSIENT_SESSION_KEY,
        persistentKey: MOCK_PERSISTENT_SESSION_KEY,
      },
    );
    expect(storage.transient).not.toBeNull();
    expect(storage.persistent).toBeNull();
    expect(writeRequests).toEqual([]);

    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(
      page.getByRole("tab", { name: "Iniciar sesión", exact: true }),
    ).toBeVisible();
    const transientSessionAfterLogout = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      MOCK_TRANSIENT_SESSION_KEY,
    );
    expect(transientSessionAfterLogout).toBeNull();
  });

  test("registra una aerolínea local y prepara su sesión", async ({ page }) => {
    await page.goto("/login?mode=register");

    await page
      .getByRole("textbox", { name: "Razón social", exact: true })
      .fill("Aerolínea Horizonte, S.A.");
    await page
      .getByRole("textbox", { name: "Nombre comercial", exact: true })
      .fill("Horizonte");
    await page
      .getByRole("textbox", { name: "Código IATA", exact: true })
      .fill("ZZ");
    await page
      .getByRole("textbox", { name: "País", exact: true })
      .fill("República Dominicana");
    await page
      .getByRole("textbox", { name: "Estación principal", exact: true })
      .fill("PUJ");
    await page
      .getByRole("textbox", { name: "Estaciones adicionales", exact: true })
      .fill("SDQ, STI");
    await page
      .getByRole("button", { name: /Continuar con el administrador/i })
      .click();

    await page
      .getByRole("textbox", { name: "Nombre completo", exact: true })
      .fill("Ana Pérez");
    await page
      .getByRole("textbox", { name: "Cargo", exact: true })
      .fill("Administradora de operaciones");
    await page
      .getByRole("textbox", { name: "Correo corporativo", exact: true })
      .fill("ana@horizonte.test");
    await page.getByLabel("Contraseña", { exact: true }).fill("LocalDemo2026!");
    await page
      .getByLabel("Confirmar contraseña", { exact: true })
      .fill("LocalDemo2026!");
    await page
      .getByRole("checkbox", { name: /Entiendo que este registro/i })
      .check();
    await page
      .getByRole("button", { name: /Crear sesión demostrativa/i })
      .click();

    await expect(
      page.getByRole("status").filter({ hasText: "Sesión demostrativa activa" }),
    ).toBeVisible();
    await expect(page.getByText("Horizonte", { exact: true })).toBeVisible();
    await expect(page.getByText("Ana Pérez", { exact: true })).toBeVisible();

    const accountDocument = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      MOCK_ACCOUNTS_STORAGE_KEY,
    );
    expect(accountDocument).not.toBeNull();
    expect(accountDocument).not.toContain("LocalDemo2026!");
  });
});
