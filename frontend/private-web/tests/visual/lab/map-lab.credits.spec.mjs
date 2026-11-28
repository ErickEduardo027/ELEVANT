import { NOON, openLab, shoot } from '../support/map.mjs';
import { expect, production, test } from '../support/test.mjs';

// M5 (review of 2026-11-28): «Créditos y licencias» is portaled onto the page's body, outside the shell's OCC scope, so
// it carries `data-department="occ"` itself. In the real browser its veil and panel must be drawn with the OCC tokens
// (not see-through) in the theme of the run (OCC_VISUAL_THEME=light for the light one), and a picture of the open
// dialog is kept for review in test-results/visual/map-lab-credits(-light).png.

const TRANSPARENT = new Set(['rgba(0, 0, 0, 0)', 'transparent', '']);

test.describe('map lab «Créditos y licencias» (M5)', () => {
  test.skip(production, 'The map lab exists in development only.');

  test('the dialog is drawn with the OCC panel, veil and text, and is kept for review', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLab(page, `scene=airfield-3d-models&t=${NOON}`);
    // The compact attribution opens closed (core/mapEngine.js): its ⓘ opens it, then its last link opens the dialog.
    const attribution = page.getByTestId('map-lab-map').locator('details.maplibregl-ctrl-attrib');
    if (await attribution.getAttribute('open') === null) await attribution.locator('summary').click();
    await expect(attribution).toHaveAttribute('open', '');
    await page.locator('a.occ-map-credits-link').first().click();
    const dialog = page.getByRole('dialog', { name: 'Créditos y licencias' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Modelos 3D de aviones' })).toBeVisible();
    const colours = await dialog.evaluate(node => {
      const panel = node;
      const scope = node.closest("[data-department='occ']");
      const style = getComputedStyle(panel);
      const scrim = node.closest('[data-occ-dialog]')?.querySelector('[data-occ-dialog-scrim]');
      return {
        scoped: scope !== null,
        panel: style.backgroundColor,
        border: style.borderTopColor,
        text: style.color,
        scrim: scrim ? getComputedStyle(scrim).backgroundColor : '',
        token: scope ? getComputedStyle(scope).getPropertyValue('--occ-panel').trim() : '',
      };
    });
    expect(colours.scoped).toBe(true);
    expect(colours.token).not.toBe('');
    expect(TRANSPARENT.has(colours.panel), `panel ${colours.panel}`).toBe(false);
    expect(TRANSPARENT.has(colours.scrim), `scrim ${colours.scrim}`).toBe(false);
    await shoot(page, testInfo, 'map-lab-credits');
  });
});
