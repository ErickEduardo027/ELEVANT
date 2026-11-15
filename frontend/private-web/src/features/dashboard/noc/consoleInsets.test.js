import { describe, expect, it } from 'vitest';
import {
  CONSOLE_INSET_GAP_PX, CONSOLE_PANEL_EDGES, MIN_VISIBLE_MAP_PX, insetsFromPanels, sameInsets,
} from './consoleInsets';

// A map of 1400 × 800 px whose box starts 240 px from the left of the window and 48 px from its top (under the status
// bar, right of the rail), as the console's map sits at 1920 × 1080 with the rail open. Rects as getBoundingClientRect
// gives them: window coordinates.
const ROOT = Object.freeze({ left: 240, top: 48, right: 1640, bottom: 848 });
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });

describe('insetsFromPanels', () => {
  it('open side panels give their width, the bottom panel its height and the top panel its height', () => {
    const panels = [
      // «Tablero» 448 px wide, 12 px in from the left edge.
      { side: 'left', rect: rect(252, 60, 448, 500), folded: false },
      // «Alertas» and the «Inspector» under it, 384 px wide, 12 px in from the right edge.
      { side: 'right', rect: rect(1244, 60, 384, 300), folded: false },
      { side: 'right', rect: rect(1244, 368, 384, 300), folded: false },
      // «Cifras de la jornada» at the top centre, 80 px high.
      { side: 'top', rect: rect(760, 60, 420, 80), folded: false },
      // «Posiciones» along the bottom, 160 px high.
      { side: 'bottom', rect: rect(252, 676, 1376, 160), folded: false },
    ];
    expect(insetsFromPanels(ROOT, panels)).toEqual({
      left: 12 + 448 + CONSOLE_INSET_GAP_PX,
      right: 12 + 384 + CONSOLE_INSET_GAP_PX,
      top: 12 + 80 + CONSOLE_INSET_GAP_PX,
      bottom: 12 + 160 + CONSOLE_INSET_GAP_PX,
    });
  });

  it('folded pills take room only at the top or the bottom edge', () => {
    const panels = [
      { side: 'left', rect: rect(252, 60, 140, 40), folded: true },
      { side: 'right', rect: rect(1500, 60, 128, 40), folded: true },
      { side: 'top', rect: rect(800, 60, 200, 40), folded: true },
      { side: 'bottom', rect: rect(252, 796, 420, 40), folded: true },
    ];
    expect(insetsFromPanels(ROOT, panels)).toEqual({ left: 0, right: 0, top: 12 + 40 + 8, bottom: 12 + 40 + 8 });
  });

  it('takes nothing from a hidden panel, one outside the map or one with an unknown side', () => {
    const panels = [
      { side: 'left', rect: rect(252, 60, 0, 0), folded: false },
      { side: 'left', rect: rect(0, 60, 200, 300), folded: false },
      { side: 'middle', rect: rect(600, 300, 200, 200), folded: false },
      { side: 'right', rect: null, folded: false },
      null,
    ];
    expect(insetsFromPanels(ROOT, panels)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(insetsFromPanels(null, [{ side: 'left', rect: rect(252, 60, 448, 500) }])).toEqual({ top: 0, right: 0,
      bottom: 0, left: 0 });
  });

  it('rounds up to whole pixels and accepts another gap', () => {
    const panels = [{ side: 'left', rect: rect(252.4, 60, 447.3, 300), folded: false }];
    expect(insetsFromPanels(ROOT, panels, 0).left).toBe(460);
    expect(insetsFromPanels(ROOT, panels).left).toBe(468);
  });

  it('opposite panels that would leave no map give back room in proportion', () => {
    // A narrow map of 900 px: 448 + 384 px of panels would leave less than the least the map keeps in sight.
    const narrow = { left: 0, top: 0, right: 900, bottom: 400 };
    const insets = insetsFromPanels(narrow, [
      { side: 'left', rect: rect(0, 0, 500, 300), folded: false },
      { side: 'right', rect: rect(400, 0, 500, 300), folded: false },
      { side: 'top', rect: rect(300, 0, 200, 150), folded: false },
      { side: 'bottom', rect: rect(0, 250, 900, 150), folded: false },
    ]);
    expect(insets.left + insets.right).toBeLessThanOrEqual(900 - MIN_VISIBLE_MAP_PX.width);
    expect(insets.left).toBe(insets.right);
    expect(insets.top + insets.bottom).toBeLessThanOrEqual(400 - MIN_VISIBLE_MAP_PX.height);
    expect(insets.top).toBe(insets.bottom);
  });

  it('names an edge for every floating panel of the console', () => {
    expect(CONSOLE_PANEL_EDGES).toEqual({ board: 'left', figures: 'top', alerts: 'right', inspector: 'right',
      positions: 'bottom' });
  });
});

describe('sameInsets', () => {
  it('compares side by side', () => {
    expect(sameInsets({ top: 1, right: 2, bottom: 3, left: 4 }, { top: 1, right: 2, bottom: 3, left: 4 })).toBe(true);
    expect(sameInsets({ top: 1, right: 2, bottom: 3, left: 4 }, { top: 1, right: 2, bottom: 3, left: 5 })).toBe(false);
    expect(sameInsets(null, { top: 0, right: 0, bottom: 0, left: 0 })).toBe(true);
  });
});
