import { describe, expect, it } from 'vitest';
import { readSource } from '../../../styles/occSourceScan';
import { MIN_VISIBLE_MAP_PX, STAGE_INSET_GAP_PX, insetsFromPanels, sameInsets } from './stageInsets';

// A map of 1400 × 800 px whose box starts 240 px from the left of the window and 48 px from its top (under the status
// bar, right of the rail), as the console's map sits at 1920 × 1080 with the rail open. Rects as getBoundingClientRect
// gives them: window coordinates.
const ROOT = Object.freeze({ left: 240, top: 48, right: 1640, bottom: 848 });
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });

// What occ-map.css declares for the map's control column, comments left out.
const MAP_CSS = readSource('src/styles/occ-map.css').replace(/\/\*[\s\S]*?\*\//g, '');
const declared = name => new RegExp(`(?:^|[\\s;{])${name}:\\s*([^;]+);`).exec(MAP_CSS)?.[1].trim() ?? null;
const ROOT_FONT_PX = 16;
// The room the control column keeps at the right edge of the map, in pixels (--occ-map-rail-reserve: the last test).
const RAIL_RESERVE_PX = 112;

describe('insetsFromPanels', () => {
  it('open side panels give their width, the bottom panel its height and the top panel its height', () => {
    // The console floating over the map (M1): its panels 12 px in from the edges and 12 px apart, those at the right
    // left of the control column's reserve (RAIL_RESERVE_PX, checked against occ-map.css below).
    const panels = [
      // «Tablero» and «Alertas» under it, in the left column, 384 px wide.
      { side: 'left', rect: rect(252, 60, 384, 500), folded: false },
      { side: 'left', rect: rect(252, 572, 384, 264), folded: false },
      // The «Inspector» in its own column, 352 px wide, left of the control column.
      { side: 'right', rect: rect(ROOT.right - RAIL_RESERVE_PX - 352, 128, 352, 520), folded: false },
      // «Cifras de la jornada» along the top, 56 px high.
      { side: 'top', rect: rect(648, 60, 880, 56), folded: false },
      // «Posiciones» along the bottom, 160 px high.
      { side: 'bottom', rect: rect(648, 676, 880, 160), folded: false },
    ];
    expect(insetsFromPanels(ROOT, panels)).toEqual({
      left: 12 + 384 + STAGE_INSET_GAP_PX,
      right: RAIL_RESERVE_PX + 352 + STAGE_INSET_GAP_PX,
      top: 12 + 56 + STAGE_INSET_GAP_PX,
      bottom: 12 + 160 + STAGE_INSET_GAP_PX,
    });
  });

  it('folded pills take room only at the top or the bottom edge', () => {
    const panels = [
      { side: 'left', rect: rect(252, 60, 132, 40), folded: true },
      { side: 'right', rect: rect(ROOT.right - RAIL_RESERVE_PX - 132, 60, 132, 40), folded: true },
      { side: 'top', rect: rect(648, 60, 100, 40), folded: true },
      { side: 'bottom', rect: rect(648, 796, 880, 40), folded: true },
    ];
    expect(insetsFromPanels(ROOT, panels)).toEqual({ left: 0, right: 0, top: 12 + 40 + 8, bottom: 12 + 40 + 8 });
  });

  it('along the bottom the higher of the status bar and the band counts; the bar alone while the panels hide (M1)', () => {
    // The console's status bar floats 12 px over the bottom edge, 40 px high, and the band 12 px over the bar.
    const bar = { side: 'bottom', rect: rect(252, ROOT.bottom - 12 - 40, 1276, 40), folded: false };
    const band = { side: 'bottom', rect: rect(648, ROOT.bottom - 12 - 40 - 12 - 160, 880, 160), folded: false };
    const bandPill = { ...band, rect: rect(648, ROOT.bottom - 12 - 40 - 12 - 40, 880, 40), folded: true };
    expect(insetsFromPanels(ROOT, [bar, band]).bottom).toBe(12 + 40 + 12 + 160 + STAGE_INSET_GAP_PX);
    expect(insetsFromPanels(ROOT, [band, bar]).bottom).toBe(12 + 40 + 12 + 160 + STAGE_INSET_GAP_PX);
    expect(insetsFromPanels(ROOT, [bar, bandPill]).bottom).toBe(12 + 40 + 12 + 40 + STAGE_INSET_GAP_PX);
    // `focus=map`: the panels hide and the bar stays over the map, taking only its own height.
    expect(insetsFromPanels(ROOT, [bar])).toEqual({ top: 0, right: 0, bottom: 12 + 40 + STAGE_INSET_GAP_PX, left: 0 });
  });

  it('takes nothing from a hidden panel, one outside the map or one with an unknown side', () => {
    const panels = [
      { side: 'left', rect: rect(252, 60, 0, 0), folded: false },
      { side: 'left', rect: rect(0, 60, 200, 300), folded: false },
      { side: 'middle', rect: rect(600, 300, 200, 200), folded: false },
      { side: 'right', rect: null, folded: false },
      // A panel the screen's edges map names no edge for.
      { side: undefined, rect: rect(252, 60, 448, 500), folded: false },
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

  it('a panel of a column takes room from the side its middle is on, and a pill from the nearer of top and bottom (CN-32)', () => {
    const map = { left: 0, top: 0, right: 1000, bottom: 600 };
    // The inspector under the board at the left (below 1536 px), then in its own column at the right, left of the
    // control column: both floating 12 px in from the edges of the map (M1).
    expect(insetsFromPanels(map, [{ side: 'side', rect: { left: 12, top: 12, right: 396, bottom: 588 } }]))
      .toEqual({ top: 0, right: 0, bottom: 0, left: 404 });
    expect(insetsFromPanels(map, [{ side: 'side', rect: { left: 536, top: 80, right: 1000 - RAIL_RESERVE_PX,
      bottom: 520 } }])).toEqual({ top: 0, right: 472, bottom: 0, left: 0 });
    // Folded at the foot of the left column, the pill of «Alertas» takes room from the bottom, not the top.
    expect(insetsFromPanels(map, [{ side: 'side', folded: true, rect: { left: 12, top: 548, right: 144, bottom: 588 } }]))
      .toEqual({ top: 0, right: 0, bottom: 60, left: 0 });
    expect(insetsFromPanels(map, [{ side: 'side', folded: true, rect: { left: 12, top: 12, right: 144, bottom: 52 } }]))
      .toEqual({ top: 60, right: 0, bottom: 0, left: 0 });
  });

  it('a panel floating left of the control column takes its width, the column\'s reserve and the gap (M1)', () => {
    // The control column stays at the true right edge of the map (occ-map.css): 12 px from it, the 5.5 rem rail, then
    // 12 px more to a panel floating at its left, which sits that reserve away from the edge.
    expect(declared('--occ-map-gap')).toBe('12px');
    expect(declared('--occ-map-rail')).toBe('5.5rem');
    expect(declared('--occ-map-rail-reserve')).toBe('calc(var(--occ-map-rail) + 2 * var(--occ-map-gap))');
    const reserve = 5.5 * ROOT_FONT_PX + 2 * 12;
    expect(reserve).toBe(RAIL_RESERVE_PX);
    // An inspector 352 px wide in the right slot, 12 px in from the top and the bottom of the map: the camera centres
    // in the area left of both the panel and the column.
    const inspector = { side: 'side', rect: rect(ROOT.right - reserve - 352, ROOT.top + 12, 352, 776), folded: false };
    expect(insetsFromPanels(ROOT, [inspector])).toEqual({
      top: 0, right: 352 + reserve + STAGE_INSET_GAP_PX, bottom: 0, left: 0,
    });
    // Folded to its pill at the top of the slot, it takes height and no width: the map keeps its whole width.
    const pill = { ...inspector, rect: rect(ROOT.right - reserve - 140, ROOT.top + 12, 140, 40), folded: true };
    expect(insetsFromPanels(ROOT, [pill])).toEqual({ top: 12 + 40 + STAGE_INSET_GAP_PX, right: 0, bottom: 0, left: 0 });
  });
});

describe('sameInsets', () => {
  it('compares side by side', () => {
    expect(sameInsets({ top: 1, right: 2, bottom: 3, left: 4 }, { top: 1, right: 2, bottom: 3, left: 4 })).toBe(true);
    expect(sameInsets({ top: 1, right: 2, bottom: 3, left: 4 }, { top: 1, right: 2, bottom: 3, left: 5 })).toBe(false);
    expect(sameInsets(null, { top: 0, right: 0, bottom: 0, left: 0 })).toBe(true);
  });
});
