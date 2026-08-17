import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  { path: "/", label: "landing" },
  { path: "/login", label: "login" },
] as const;

test.describe("calidad responsive y accesible", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  for (const route of routes) {
    test(`${route.label} no produce overflow horizontal`, async ({ page }) => {
      await page.goto(route.path);
      await page.locator("footer").scrollIntoViewIfNeeded();

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
});
