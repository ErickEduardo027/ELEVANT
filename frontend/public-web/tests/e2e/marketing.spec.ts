import { expect, test } from "@playwright/test";

const serviceId = "20000000-0000-7000-8000-000000000006";
const airlineId = "20000000-0000-7000-8000-000000000003";

async function stubCommercialCatalog(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/public/commercial-catalog", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      services: [{ id: serviceId, name: "Baggage handling", description: "Servicio de rampa",
        imageUrl: null, videoUrl: null, displayOrder: 1 }],
      airlines: [{ id: airlineId, name: "Synthetic Airways", region: "Caribbean",
        legalName: null, countryCode: null, iataCode: null, icaoCode: null,
        logoUrl: null, isVerified: false }],
    }),
  }));
}

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

    await stubCommercialCatalog(page);
    const primaryCta = page.locator(".hero")
      .getByRole("link", { name: "Solicitar acceso" });
    await expect(primaryCta).toHaveAttribute("href", "/solicitar-acceso");
    await primaryCta.click();

    await expect(page).toHaveURL(/\/solicitar-acceso$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Su próxima escala empieza aquí/i,
      }),
    ).toBeVisible();
  });

  test("envía la solicitud comercial canónica y confirma solo la referencia recibida", async ({
    page,
  }) => {
    await stubCommercialCatalog(page);
    const submissions: Array<Record<string, unknown>> = [];
    await page.route("**/api/v1/public/commercial-requests", async route => {
      submissions.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 201, contentType: "application/json",
        body: JSON.stringify({ reference: "REQ-SYNTHETIC-001", replayed: false }) });
    });
    await page.goto("/solicitar-acceso");
    await page.getByRole("button", { name: "Añadir servicio +" }).click();
    await page.getByRole("button", { name: /Continuar/i }).click();
    await page.getByRole("combobox", { name: "Seleccione una aerolínea" }).selectOption(airlineId);
    await page.getByRole("button", { name: /Continuar/i }).click();
    await page.getByRole("textbox", { name: "Nombre completo" }).fill("Ana Synthetic");
    await page.getByRole("textbox", { name: "Cargo" }).fill("Gerente de operaciones");
    await page.getByRole("textbox", { name: "Correo corporativo" }).fill("ana@synthetic.example.test");
    await page.getByRole("textbox", { name: "Teléfono" }).fill("+1 809 555 0100");
    await page.getByRole("checkbox", { name: /Declaro que estoy autorizado/i }).check();
    await page.getByRole("button", { name: /Enviar solicitud/i }).click();
    await expect(page.getByRole("status")).toContainText("REQ-SYNTHETIC-001");
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ airlineProfileId: airlineId, serviceIds: [serviceId],
      representativeEmail: "ana@synthetic.example.test", authorityDeclared: true });
    expect(submissions[0]).not.toHaveProperty("password");
  });

  test("navega al login real y ofrece la solicitud como enlace", async ({ page }) => {
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
      page.getByRole("region", { name: "Iniciar sesión", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Solicitar acceso" }))
      .toHaveAttribute("href", "/solicitar-acceso");
    await expect(
      page.getByRole("textbox", { name: "Correo corporativo", exact: true }),
    ).toBeVisible();
  });
});
