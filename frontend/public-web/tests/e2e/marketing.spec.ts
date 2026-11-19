import { expect, test } from "@playwright/test";

const serviceId = "20000000-0000-7000-8000-000000000006";
const airlineId = "20000000-0000-7000-8000-000000000003";

/**
 * Opens the landing with the headline font loaded. The headline is measured in the display font,
 * not in the fallback one, which wraps differently.
 */
async function gotoLandingWithFonts(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    await document.fonts.load('700 1rem "Bricolage Grotesque"');
    await document.fonts.ready;
  });
}

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
    // The airline's tax identifier: with Dominican Republic as its country it is an RNC.
    await page.getByRole("combobox", { name: "País del identificador fiscal" }).selectOption("DO");
    await page.getByRole("textbox", { name: "RNC" }).fill("1-31-23456-9");
    await page.getByRole("button", { name: /Continuar/i }).click();
    await page.getByRole("textbox", { name: "Nombre completo" }).fill("Ana Synthetic");
    await page.getByRole("combobox", { name: "Cargo" }).selectOption("Gerente de operaciones");
    await page.getByRole("textbox", { name: "Correo corporativo" }).fill("ana@synthetic.example.test");
    await page.getByRole("textbox", { name: "Teléfono" }).fill("+1 809 555 0100");
    // «Otro» no longer exists; a Dominican passport shows a fixed RD and takes only its 7 digits.
    await expect(page.getByRole("combobox", { name: "Tipo de documento" }).locator("option"))
      .toHaveText(["Seleccione", "Cédula", "Pasaporte"]);
    await page.getByRole("combobox", { name: "Tipo de documento" }).selectOption("Passport");
    await page.getByRole("combobox", { name: "Nacionalidad del pasaporte" }).selectOption("DO");
    const documentNumber = page.getByRole("textbox", { name: "Número de documento" });
    await expect(page.getByTitle("Pasaporte dominicano")).toHaveText("RD");
    await documentNumber.fill("1234567");
    await expect(documentNumber).toHaveValue("1234567");
    await page.getByRole("combobox", { name: "País" }).selectOption("DO");
    await page.getByRole("combobox", { name: "Provincia / Estado / Región" }).selectOption("25");
    await page.getByRole("combobox", { name: "Municipio / Ciudad" }).selectOption("Santiago de los Caballeros");
    await page.getByRole("checkbox", { name: /Declaro que estoy autorizado/i }).check();
    await page.getByRole("button", { name: /Continuar/i }).click();
    await page.getByRole("button", { name: /Enviar solicitud/i }).click();
    await expect(page.getByRole("status")).toContainText("REQ-SYNTHETIC-001");
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ airlineProfileId: airlineId, serviceIds: [serviceId],
      representativeEmail: "ana@synthetic.example.test", authorityDeclared: true,
      representativeTitle: "Gerente de operaciones", representativeCountry: "República Dominicana",
      representativeProvince: "Santiago", representativeMunicipality: "Santiago de los Caballeros",
      representativeDocumentType: "Passport", representativeDocumentNumber: "RD1234567",
      representativeNationalityCode: "DO", taxRegistration: "131234569", taxRegistrationCountryCode: "DO" });
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
      page.getByRole("region", { name: "Continúe al portal de su aerolínea." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Solicite acceso aquí" }))
      .toHaveAttribute("href", "/solicitar-acceso");
    await expect(
      page.getByRole("textbox", { name: "Correo corporativo", exact: true }),
    ).toBeVisible();
  });

  // N20: short desktop windows and landscape phones also size the headline by the window
  // height, so it ends inside the first screen, below the header.
  const shortWindows = [
    { width: 1366, height: 657 },
    { width: 1568, height: 653 },
    { width: 1280, height: 600 },
    { width: 1936, height: 806 },
    { width: 1920, height: 800 },
    { width: 844, height: 390 },
  ];

  for (const viewport of shortWindows) {
    test(`el titular cabe en la primera pantalla de ${viewport.width}x${viewport.height}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Fixed window sizes");
      await page.setViewportSize(viewport);
      await gotoLandingWithFonts(page);

      const title = page.getByRole("heading", { level: 1, name: /historia verificable/ });
      await expect(title).toBeVisible();
      const titleBox = (await title.boundingBox())!;
      expect(Math.ceil(titleBox.y + titleBox.height), `El titular termina dentro de los ${viewport.height}px de alto`)
        .toBeLessThanOrEqual(viewport.height);
      const headerBox = (await page.locator(".site-header").boundingBox())!;
      expect(titleBox.y, "El titular empieza debajo del encabezado")
        .toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
      // Nor does the bottom edge slice a line of the lead that follows it.
      const slicedLines = await page.locator(".hero__lead").evaluate((lead, fold) => {
        const range = document.createRange();
        range.selectNodeContents(lead);
        return [...range.getClientRects()].filter((line) => line.top < fold && line.bottom > fold).length;
      }, viewport.height);
      expect(slicedLines, "Ninguna línea de la entradilla queda cortada por el borde inferior").toBe(0);
    });
  }

  // N20: on a first visit the display font arrives late. The headline already wraps at the width it keeps once the
  // font is in, so it never stays on a fifth line below the fold, not even with its entrance animation running.
  for (const viewport of [{ width: 1366, height: 657 }, { width: 1568, height: 653 }]) {
    test(`el titular cabe en ${viewport.width}x${viewport.height} aunque la fuente llegue tarde`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Fixed window sizes");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.setViewportSize(viewport);
      let releaseFonts!: () => void;
      const fontsHeld = new Promise<void>((resolve) => { releaseFonts = resolve; });
      await page.route("**/assets/fonts/**", async (route) => {
        await fontsHeld;
        await route.continue();
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });

      const title = page.getByRole("heading", { level: 1, name: /historia verificable/ });
      // Until the font arrives the headline is laid out in the fallback font.
      const headlineAnimation = (atLeast: number) => page.waitForFunction((ms) => {
        const animation = document.querySelector(".hero h1")?.getAnimations()[0];
        return Boolean(animation && Number(animation.currentTime) >= ms);
      }, atLeast, { polling: "raf" });
      await headlineAnimation(0);
      const widthBeforeFont = await title.evaluate((element) => getComputedStyle(element).maxWidth);
      // The font arrives halfway through the entrance animation: with a max-width in `ch`, Chrome could keep the
      // fallback font's width there for good, and the headline stayed on five lines.
      await headlineAnimation(450);
      releaseFonts();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.querySelector(".hero h1")!.getAnimations().map((animation) => animation.finished));
      });

      // Measured once: nothing is polled, the first layout with the font must already fit.
      const lines = await title.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size;
      });
      const box = (await title.boundingBox())!;
      expect(lines, "El titular ocupa cuatro líneas").toBe(4);
      expect(Math.ceil(box.y + box.height), `El titular termina dentro de los ${viewport.height}px de alto`)
        .toBeLessThanOrEqual(viewport.height);
      expect(await title.evaluate((element) => getComputedStyle(element).maxWidth),
        "El ancho del titular no depende de qué fuente está cargada").toBe(widthBeforeFont);
    });
  }

  // Portrait phones and tall windows keep the width-only size of the headline.
  const unchangedWindows = [
    { width: 390, height: 844, fontSize: 51.2 }, // clamp(3.2rem, 12vw, 8.7rem)
    { width: 360, height: 780, fontSize: 51.2 },
    { width: 1440, height: 900, fontSize: 123.2 }, // clamp(7.7rem, 8.4vw, 10.5rem)
  ];

  for (const viewport of unchangedWindows) {
    test(`el titular conserva su tamaño en ${viewport.width}x${viewport.height}`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Fixed window sizes");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoLandingWithFonts(page);

      const title = page.getByRole("heading", { level: 1, name: /historia verificable/ });
      await expect(title).toBeInViewport({ ratio: 1 });
      const fontSize = await title.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      expect(fontSize).toBeCloseTo(viewport.fontSize, 1);
    });
  }

  test("el héroe no muestra la pastilla técnica del motor 3D", async ({ page }) => {
    await page.goto("/");

    const scene = page.locator(".hero__media [data-render-state]");
    await expect(scene).toHaveAttribute("data-graphics-tier", /^(FULL|LITE)$/);
    await expect(page.locator(".hero")).not.toContainText(/MOTOR 3D|RESPALDO VISUAL/);
  });
});
