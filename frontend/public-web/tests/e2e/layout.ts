import { expect, type Page } from "@playwright/test";

type Offender = { selector: string; left: number; right: number };

/**
 * Comprueba que ningún elemento visible sobresalga del viewport. `body` usa
 * `overflow-x: clip`, por lo que `scrollWidth` no basta: un contenido recortado
 * no genera scroll pero sí queda fuera de la pantalla. Se ignoran elementos
 * dentro de contenedores con desplazamiento horizontal propio.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const offenders = await page.evaluate<Offender[]>(() => {
    const viewport = document.documentElement.clientWidth;
    const found: Offender[] = [];
    const flagged = new Set<Element>();
    for (const element of document.querySelectorAll("body *")) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || box.right <= 0 || box.left >= viewport) continue;
      if (box.right <= viewport + 1 && box.left >= -1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || Number(style.opacity) === 0 || style.position === "fixed") continue;
      let parent = element.parentElement;
      let contained = false;
      while (parent && parent !== document.body) {
        if (flagged.has(parent)) { contained = true; break; }
        const overflowX = getComputedStyle(parent).overflowX;
        const parentBox = parent.getBoundingClientRect();
        if (["auto", "scroll", "hidden", "clip"].includes(overflowX)
          && parentBox.right <= viewport + 1 && parentBox.left >= -1) { contained = true; break; }
        parent = parent.parentElement;
      }
      if (contained) continue;
      flagged.add(element);
      const className = typeof element.className === "string" ? element.className.split(" ")[0] : "";
      found.push({ selector: `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}`,
        left: Math.round(box.left), right: Math.round(box.right) });
    }
    return found.slice(0, 5);
  });
  expect(offenders, `Elementos fuera del viewport en ${label}`).toEqual([]);
}
