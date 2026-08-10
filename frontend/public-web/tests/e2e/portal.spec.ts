import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MODULES = [
  {
    label: "Contratos",
    path: "/portal/contratos",
    heading: "Contratos y tarifarios",
  },
  {
    label: "Documentos",
    path: "/portal/documentos",
    heading: "Documentos de la operación",
  },
  {
    label: "Finanzas",
    path: "/portal/finanzas",
    heading: "Finanzas claras, respuesta controlada.",
  },
  {
    label: "Reportes",
    path: "/portal/reportes",
    heading: "Reportes operativos y financieros",
  },
  {
    label: "Solicitudes",
    path: "/portal/solicitudes",
    heading: "Solicitudes con estado visible.",
  },
  {
    label: "Perfil",
    path: "/portal/perfil",
    heading: "Tu alcance, siempre visible.",
  },
] as const;

function pathPattern(path: string): RegExp {
  return new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

async function clearBrowserState(page: Page) {
  await page.goto("/login?mode=login");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
}

async function submitDemoLogin(page: Page) {
  await expect(page).toHaveURL(/\/login/);
  await page
    .getByRole("button", { name: /Usar credenciales de demostración/i })
    .click();
  await page
    .getByRole("button", { name: "Iniciar sesión", exact: true })
    .click();
}

async function loginDemo(page: Page, returnTo = "/portal") {
  const query = new URLSearchParams({ mode: "login", returnTo }).toString();
  await page.goto(`/login?${query}`);
  await submitDemoLogin(page);
  await expect(page).toHaveURL(pathPattern(returnTo), { timeout: 15_000 });
  await expect(page.locator("#portal-content")).toBeVisible();
}

async function navigateFromPortal(
  page: Page,
  label: string,
  path: string,
) {
  const desktopLink = page
    .locator("aside")
    .getByRole("link", { name: label, exact: true });

  if (await desktopLink.isVisible()) {
    await desktopLink.click();
  } else {
    const mobileLink = page
      .getByRole("navigation", { name: "Navegación móvil" })
      .getByRole("link", { name: label, exact: true });

    if (await mobileLink.isVisible()) {
      await mobileLink.click();
    } else {
      const moreSections = page.getByRole("button", {
        name: "Abrir más secciones",
      });
      if (await moreSections.isVisible()) {
        await moreSections.click();
      } else {
        await page.getByRole("button", { name: "Abrir navegación" }).click();
      }
      const drawer = page.getByRole("dialog", { name: "Navegación" });
      await expect(drawer).toBeVisible();
      await drawer.getByRole("link", { name: label, exact: true }).click();
    }
  }

  await expect(page).toHaveURL(pathPattern(path));
}

async function expectNoHorizontalOverflow(page: Page, path: string) {
  const dimensions = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      clientWidth: root.clientWidth,
      scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      viewportWidth: window.innerWidth,
    };
  });

  expect(
    dimensions.scrollWidth,
    `Overflow horizontal en ${path}: ${JSON.stringify(dimensions)}`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test.describe("portal mock de aerolíneas", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await clearBrowserState(page);
  });

  test("protege rutas anónimas y conserva un returnTo interno al iniciar la demo", async ({
    page,
  }) => {
    await page.goto("/portal/finanzas");

    await expect(page).toHaveURL(
      /\/login\?mode=login&returnTo=%2Fportal%2Ffinanzas$/,
    );
    await submitDemoLogin(page);

    await expect(page).toHaveURL(/\/portal\/finanzas$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Finanzas claras, respuesta controlada.",
      }),
    ).toBeVisible();
    await expect(page.getByText("FAC-ZZ-SECRET")).toHaveCount(0);
  });

  test("recorre inicio, vuelos, detalle y todos los módulos desde la navegación", async ({
    page,
  }) => {
    await loginDemo(page);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Tu operación, en una sola secuencia.",
      }),
    ).toBeVisible();

    await navigateFromPortal(page, "Vuelos", "/portal/vuelos");
    await expect(
      page.getByRole("heading", { level: 1, name: "Vuelos", exact: true }),
    ).toBeVisible();

    const detailLink = page
      .getByRole("link", {
        name: /(?:Abrir rotación|Ver detalle del vuelo)/i,
      })
      .first();
    await expect(detailLink).toBeVisible();
    await detailLink.click();
    await expect(page).toHaveURL(/\/portal\/vuelos\/[^/]+$/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Servicios y SLA" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Línea de tiempo" }),
    ).toBeVisible();

    for (const portalModule of MODULES) {
      await test.step(`abre ${portalModule.label}`, async () => {
        await navigateFromPortal(page, portalModule.label, portalModule.path);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: portalModule.heading,
            exact: true,
          }),
        ).toBeVisible();
      });
    }

    await expect(page.getByText("Notificación reservada")).toHaveCount(0);
  });

  test("crea una solicitud mock y conserva su trazabilidad al recargar", async ({
    page,
  }) => {
    await loginDemo(page, "/portal/solicitudes");
    await page.getByRole("button", { name: "Nueva solicitud" }).click();

    const dialog = page.getByRole("dialog", { name: "Nueva solicitud" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Título").fill("Equipo adicional para prueba E2E");
    await dialog
      .getByLabel("Detalle operacional")
      .fill("Solicitamos una escalera adicional para validar el flujo local.");
    await dialog.getByRole("button", { name: "Enviar solicitud" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Solicitud recibida" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Equipo adicional para prueba E2E" }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Equipo adicional para prueba E2E" }),
    ).toBeVisible();
  });

  test("acepta una prefactura por identidad y gestiona las notificaciones", async ({
    page,
  }) => {
    await loginDemo(page, "/portal/finanzas");

    const prebill = page
      .locator("article")
      .filter({
        has: page.getByRole("heading", {
          level: 2,
          name: "PRE-EV-2026-08",
          exact: true,
        }),
      });
    await expect(prebill).toBeVisible();
    await prebill.getByRole("button", { name: "Aceptar prefactura" }).click();

    const dialog = page.getByRole("dialog", { name: "Aceptar prefactura" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("Nota de confirmación")
      .fill("Validada por el equipo financiero en la prueba E2E.");
    await dialog.getByRole("button", { name: "Confirmar respuesta" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Prefactura aceptada" }),
    ).toBeVisible();
    await expect(prebill.getByText("Aceptado", { exact: true })).toBeVisible();

    const notifications = page.getByRole("button", {
      name: /Notificaciones, \d+ sin leer/i,
    });
    await notifications.click();
    const notificationCenter = page.getByRole("dialog", {
      name: "Centro de notificaciones",
    });
    await expect(notificationCenter).toBeVisible();
    await notificationCenter
      .getByRole("button", { name: "Marcar todas como leídas" })
      .click();
    await expect(
      page.getByRole("button", { name: "Notificaciones", exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Notificaciones", exact: true }),
    ).toBeVisible();
    await expect(prebill.getByRole("button", { name: "Aceptar prefactura" })).toHaveCount(0);
  });

  test("mantiene el portal responsive y sin bloqueos axe serios o críticos", async ({
    page,
  }, testInfo) => {
    await loginDemo(page);

    const checkedRoutes = [
      "/portal",
      ...MODULES.map((portalModule) => portalModule.path),
    ];
    for (const path of checkedRoutes) {
      await test.step(`${testInfo.project.name}: ${path} sin overflow`, async () => {
        await page.goto(path);
        await expect(page.locator("#portal-content")).toBeVisible();
        await expectNoHorizontalOverflow(page, path);
      });
    }

    await page.goto("/portal");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Tu operación, en una sola secuencia.",
      }),
    ).toBeVisible();

    const axePage = page as unknown as ConstructorParameters<
      typeof AxeBuilder
    >[0]["page"];
    const results = await new AxeBuilder({ page: axePage })
      .include("#portal-content")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blockers = results.violations
      .filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.flatMap((node) => node.target),
      }));

    expect(blockers).toEqual([]);
  });
});
