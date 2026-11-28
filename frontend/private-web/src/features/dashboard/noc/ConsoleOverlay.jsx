'use client';

import { STAGE_SIDE_EDGE } from '../../maps/ui/stageInsets';
import { OCC_FLOATING_PANEL_LAYOUT } from '../../occ-ui/OccFloatingPanel';

// Where the console's panels go (contratos 2.5, owner decision 15; CN-32; M1 «pantalla completa con paneles
// flotantes»). Over the map (`float`) the panels float on the near-opaque slab of OccFloatingPanel, 12 px from the edges
// of the map and from each other (--occ-map-gap), with the map in sight around them:
// - the left column, the console's lists: «Tablero» over «Alertas» (with «Pendientes de la jornada»);
// - «Cifras de la jornada», one line of figures along the top of the map;
// - «Posiciones», the band of the stands along the bottom of the map;
// - the «Inspector» of the selection: from 1536 px (`wide`) a column of its own at the right of the map, between the
//   figures and the band, the slot the panel of «Seguir en 3D» takes too; below 1536 px it goes into the left column
//   under «Tablero» and «Alertas» fold away while it is open (as Mapa de posiciones folds its list), so the map keeps
//   its width on a 1366 px laptop;
// - under them all, the console's status bar (`status`): the provenance line, «Ocultar paneles», the weather and the
//   delays of the airport. It stays while the panels hide (`showPanels` false, `focus=map`), and the map measures it as
//   a panel along its bottom edge, so the key of the map and its corners keep above it.
// The map's control column (its zoom group and maps/ui/MapDock.jsx, placed by occ-map.css) stays at the true right edge
// of the map (M1): the stage keeps clear of its reserve (--occ-map-rail-reserve), so the inspector floats 12 px left of
// the rail and the strips along the top and the bottom stop as far short of it. A folded panel shrinks to its pill. In
// the fallback (`grid`), when the map engine cannot draw: the same panels as a plain grid beside the map's list, the
// status bar at its foot. The panels are children of OccMap but never of MapLibre's container, so the band's arrows
// never move the map. The classes are pure, so a test can read what jsdom does not lay out.

/**
 * The edge of the map each panel of the console takes room from (maps/ui/stageInsets.js, measured by useStageInsets):
 * the panels of the columns take it from the side they sit at (STAGE_SIDE_EDGE, resolved by where their middle falls);
 * the strip of figures from the top; the band and the status bar from the bottom; and «Mostrar paneles», alone at the
 * top left of the maximised map (`focus=map`, ConsolePage.jsx), from the top, so the pill of a new arrival opens under
 * it instead of over it.
 */
export const CONSOLE_PANEL_EDGES = Object.freeze({
  board: STAGE_SIDE_EDGE,
  figures: 'top',
  alerts: STAGE_SIDE_EDGE,
  inspector: STAGE_SIDE_EDGE,
  positions: 'bottom',
  status: 'bottom',
  showPanels: 'top',
});

// A folded panel of a column: its pill at the head of the column, as wide as its title.
const PILL = 'data-[folded=true]:flex-none data-[folded=true]:self-start';
// The line of the status bar: the provenance, «Ocultar paneles» and the pills, wrapping on a narrow map.
const STATUS_LINE = 'flex min-h-10 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1';

export const CONSOLE_OVERLAY_LAYOUT = Object.freeze({
  float: Object.freeze({
    // The stage: the whole map, 12 px in from its edges and, at the right, the control column's reserve. It takes no
    // pointer and makes no layer of its own, so each of its two parts keeps its own layer among the cards of the map.
    root: 'pointer-events-none absolute inset-0 flex flex-col gap-3 p-3 pr-[var(--occ-map-rail-reserve)]',
    // The panels, under the cards of the map (z-20: «Seguir en 3D», the pill of a new arrival) and under the control
    // column (z-30, occ-map.css).
    panels: 'relative z-10 grid min-h-0 flex-1 grid-cols-[24rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] '
      + 'gap-3 2xl:grid-cols-[24rem_minmax(0,1fr)_auto] 3xl:grid-cols-[26rem_minmax(0,1fr)_auto]',
    lists: 'col-start-1 row-span-3 row-start-1 flex min-h-0 min-w-0 flex-col gap-3',
    figures: 'col-start-2 row-start-1 flex min-w-0 items-start 2xl:col-span-2',
    side: 'col-start-3 row-start-2 flex min-h-0 w-[22rem] min-w-0 flex-col items-stretch 3xl:w-[24rem]',
    positions: 'col-start-2 row-start-3 flex min-w-0 items-end 2xl:col-span-2',
    // The status bar at the foot of the stage, on the floating slab: over the cards of the map, so the details its
    // pills open upwards (the weather, the delays) cover them, and under the control column and its menus.
    status: `pointer-events-auto relative z-[25] mt-auto ${STATUS_LINE} ${OCC_FLOATING_PANEL_LAYOUT.float}`,
    // Each panel takes the pointer; folded, it shrinks to its pill.
    boardPanel: `pointer-events-auto min-h-0 flex-1 basis-0 ${PILL}`,
    figuresPanel: 'pointer-events-auto w-full data-[folded=true]:w-auto',
    // «Alertas» keep to the foot of the column, open or folded, whether «Tablero» is open over them or a pill.
    alertsPanel: `pointer-events-auto mt-auto max-h-[40%] min-h-0 shrink-0 ${PILL}`,
    // Below 1536 px the inspector takes the place of «Alertas» in the left column while it is open.
    alertsPanelWithInspector: `pointer-events-auto mt-auto max-h-[40%] min-h-0 shrink-0 ${PILL} max-2xl:hidden`,
    inspectorPanel: `pointer-events-auto min-h-0 flex-[1.35] basis-0 ${PILL}`,
    inspectorPanelWide: 'pointer-events-auto min-h-0 flex-1 data-[folded=true]:flex-none data-[folded=true]:self-end',
    positionsPanel: 'pointer-events-auto w-full',
  }),
  // The figures first across the grid, then the board beside the alerts and the inspector, then the band and the status
  // bar across.
  grid: Object.freeze({
    root: 'grid min-w-0 grid-cols-1 content-start gap-2 p-2 lg:grid-cols-2',
    lists: 'order-2 flex min-w-0 flex-col gap-2',
    figures: 'order-1 min-w-0 lg:col-span-2',
    side: 'order-3 flex min-w-0 flex-col gap-2',
    positions: 'order-4 min-w-0 lg:col-span-2',
    status: `order-5 lg:col-span-2 ${STATUS_LINE} ${OCC_FLOATING_PANEL_LAYOUT.grid}`,
    boardPanel: 'max-h-[36rem]',
    figuresPanel: '',
    alertsPanel: 'max-h-[28rem]',
    alertsPanelWithInspector: 'max-h-[28rem]',
    inspectorPanel: 'max-h-[36rem]',
    inspectorPanelWide: 'max-h-[36rem]',
    positionsPanel: 'w-full',
  }),
});

/**
 * The panels in their places. `layout` is `float` (floating over the map) or `grid` (the fallback); `board`, `figures`,
 * `alerts`, `inspector` and `positions` are the panels, each already given its class of CONSOLE_OVERLAY_LAYOUT. `wide`
 * (from 1536 px) gives the inspector its own column at the right of the map; otherwise it goes under the board.
 * `status` is what the status bar holds and `statusRef` the ref the map measures the bar through (useStageInsets).
 * With `showPanels: false` (the maximised map, `focus=map`) the status bar stays alone over the map.
 */
export default function ConsoleOverlay({
  layout = 'float', wide = false, showPanels = true, board, figures, alerts, inspector, positions, status = null,
  statusRef,
}) {
  const classes = CONSOLE_OVERLAY_LAYOUT[layout] ?? CONSOLE_OVERLAY_LAYOUT.float;
  const statusBar = status === null ? null
    : <div ref={statusRef} data-occ-console-status="" className={classes.status}>{status}</div>;
  if (layout === 'grid') {
    return (
      <div data-occ-console-panels={layout} className={classes.root}>
        <div className={classes.lists}>{board}</div>
        <div className={classes.figures}>{figures}</div>
        <div className={classes.side}>
          {alerts}
          {inspector}
        </div>
        <div className={classes.positions}>{positions}</div>
        {statusBar}
      </div>
    );
  }
  const sideInspector = wide && inspector;
  return (
    <div data-occ-console-panels={layout} data-occ-console-wide={wide ? 'true' : 'false'} className={classes.root}>
      {showPanels ? (
        <div data-occ-console-grid="" className={classes.panels}>
          <div className={classes.lists}>
            {board}
            {alerts}
            {sideInspector ? null : inspector}
          </div>
          <div className={classes.figures}>{figures}</div>
          {sideInspector ? <div data-occ-console-side="" className={classes.side}>{inspector}</div> : null}
          <div className={classes.positions}>{positions}</div>
        </div>
      ) : null}
      {statusBar}
    </div>
  );
}
