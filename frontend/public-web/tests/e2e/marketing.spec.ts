import { expect, test } from "@playwright/test";

import {
  DEMO_REQUEST_INVALID_MESSAGE,
  DEMO_REQUEST_NO_TRANSMISSION_MESSAGE,
} from "../../src/lib/demo-request";

test.describe("landing pública", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("expone sus CTA y anclas principales", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle(/ELEVANT/i);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Cada rotaci.+n deja una historia verificable/i,
      }),
    ).toBeVisible();

    const menuToggle = page.getByRole("button", {
      name: /Abrir navegaci/i,
    });
    if (await menuToggle.isVisible()) await menuToggle.click();

    const mainNavigation = page.locator("header").getByRole("navigation");
    const anchors = [
      ["Experiencia", "#experiencia"],
      ["Flujo", "#flujo"],
      ["Capacidades", "#capacidades"],
      ["Piloto", "#piloto"],
    ] as const;

    for (const [name, href] of anchors) {
      await expect(
        mainNavigation.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", href);
      await expect(page.locator(href)).toHaveCount(1);
    }

    const closeMenu = page.getByRole("button", {
      name: /Cerrar navegaci/i,
    });
    if (await closeMenu.isVisible()) await closeMenu.click();

    const primaryCta = page
      .locator(".hero")
      .getByRole("link", { name: /Solicitar demostraci/i });
    await expect(primaryCta).toHaveAttribute("href", "#demo");
    await primaryCta.click();

    await expect(page).toHaveURL(/#demo$/);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: /Haga visible cada servicio/i,
      }),
    ).toBeVisible();
  });

  test("valida localmente y comunica que ningún dato fue transmitido", async ({
    page,
  }) => {
    await page.goto("/#demo");
    await page.waitForLoadState("networkidle");

    const writeRequests: Array<{ method: string; url: string }> = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD"].includes(request.method())) {
        writeRequests.push({ method: request.method(), url: request.url() });
      }
    });

    const submit = page.getByRole("button", { name: /Preparar solicitud/i });
    await submit.click();

    await expect(
      page.getByRole("alert").filter({ hasText: DEMO_REQUEST_INVALID_MESSAGE }),
    ).toBeVisible();
    const nameInput = page.getByRole("textbox", {
      name: "Nombre",
      exact: true,
    });
    await expect(nameInput).toBeFocused();
    await expect(nameInput).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await nameInput.fill("Ana Pérez");
    await page
      .getByRole("textbox", { name: /^Aerol/i })
      .fill("Aerolínea Ejemplo");
    await page
      .getByRole("textbox", { name: "Cargo", exact: true })
      .fill("Gerente de operaciones");
    await page
      .getByRole("textbox", { name: "Correo corporativo", exact: true })
      .fill("ana@aerolinea.example");
    await page
      .getByRole("textbox", { name: /^Estaci/i })
      .fill("PUJ · República Dominicana");
    await page
      .getByRole("textbox", { name: "Necesidad operativa", exact: true })
      .fill("Trazabilidad de servicios en rampa.");
    await submit.click();

    await expect(
      page
        .getByRole("status")
        .filter({ hasText: DEMO_REQUEST_NO_TRANSMISSION_MESSAGE }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/#demo$/);
    expect(writeRequests).toEqual([]);
  });

  test("navega al acceso mock para aerolíneas", async ({ page }) => {
    await page.goto("/");

    const menuToggle = page.getByRole("button", {
      name: /Abrir navegaci/i,
    });
    if (await menuToggle.isVisible()) await menuToggle.click();

    await page
      .locator("header")
      .getByRole("link", { name: "INICIAR SESIÓN", exact: true })
      .click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /La operación, visible para quien debe verla/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Iniciar sesión", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("textbox", { name: "Correo corporativo", exact: true }),
    ).toBeVisible();
  });
});
