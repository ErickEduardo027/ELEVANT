import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./layout";

const routes = [
  { path: "/", label: "landing" },
  { path: "/login", label: "login" },
  { path: "/solicitar-acceso", label: "solicitud de acceso" },
] as const;

test.describe("calidad responsive y accesible", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const route of routes) {
    test(`${route.label} no produce overflow horizontal`, async ({ page }) => {
      await page.goto(route.path);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expectNoHorizontalOverflow(page, route.path);

      const measurement = await page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;

        return {
          clientWidth: root.clientWidth,
          scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
          viewportWidth: window.innerWidth,
        };
      });

      expect(
        measurement.scrollWidth,
        `Overflow en ${route.path}: ${JSON.stringify(measurement)}`,
      ).toBeLessThanOrEqual(measurement.clientWidth);
    });

    test(`${route.label} no tiene violaciones axe serias o críticas`, async ({
      page,
    }) => {
      await page.goto(route.path);

      // @axe-core/playwright can resolve a newer patch of playwright-core than
      // @playwright/test. Their Page objects are runtime-compatible, although
      // TypeScript treats the two private dependency paths as distinct types.
      const axePage = page as unknown as ConstructorParameters<
        typeof AxeBuilder
      >[0]["page"];
      const results = await new AxeBuilder({ page: axePage })
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
  }

  // N15: the six services of a page fill complete rows (three, two or one per row
  // by the panel's width) and none is hidden in a horizontal scroll.
  test("solicitud de acceso muestra seis servicios en filas completas sin overflow horizontal", async ({
    page,
  }) => {
    await page.route("**/api/v1/public/commercial-catalog", route => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({
        services: Array.from({ length: 9 }, (_, index) => ({
          id: `20000000-0000-7000-8000-${String(100 + index).padStart(12, "0")}`,
          name: `Servicio ${index + 1}`, description: "Servicio de rampa",
          imageUrl: null, videoUrl: null, displayOrder: index + 1,
        })),
        airlines: [],
      }),
    }));
    await page.goto("/solicitar-acceso");
    const services = page.getByLabel("Servicios disponibles");
    await expect(services.getByRole("article")).toHaveCount(6);
    await expect(page.getByText("SERVICIOS 1–6 DE 9")).toBeVisible();

    const layout = await services.evaluate((grid) => {
      const tops = [...grid.querySelectorAll("article")]
        .map((card) => Math.round(card.getBoundingClientRect().top));
      return {
        overflowX: getComputedStyle(grid).overflowX,
        scrollWidth: grid.scrollWidth,
        clientWidth: grid.clientWidth,
        rows: [...new Set(tops)].map((top) => tops.filter((value) => value === top).length),
      };
    });
    expect(layout.overflowX).toBe("visible");
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect([1, 2, 3]).toContain(layout.rows[0]);
    expect(layout.rows).toEqual(Array(6 / layout.rows[0]).fill(layout.rows[0]));
    await expectNoHorizontalOverflow(page, "/solicitar-acceso con seis servicios");

    await page.getByRole("button", { name: "Ver servicios siguientes" }).click();
    await expect(page.getByText("SERVICIOS 7–9 DE 9")).toBeVisible();
    await expect(services.getByRole("article")).toHaveCount(3);
  });
});
