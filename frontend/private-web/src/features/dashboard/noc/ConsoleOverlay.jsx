'use client';

// Where the console's panels go (contratos 2.5, owner decision 15). Over the map (`float`): a grid laid over the whole
// map that takes no pointer itself, «Tablero» down the left, «Cifras de la jornada» at the top centre, «Alertas» with the
// «Inspector» under it down the right, and «Posiciones» along the bottom; a folded panel shrinks to its pill in its
// corner. Above «Posiciones» a row stays free across the whole map for the maps lane's dock (its view selector, layers
// and legend, placed by occ-map.css at the bottom centre of the area the insets leave): when the panels leave the map
// less room than the dock needs (1440 px with both sides open), the dock runs under no panel. In the fallback (`grid`),
// when the map engine cannot draw: the same panels as a plain grid beside the map's list. The panels are children of
// OccMap but never of MapLibre's container, so the band's arrows never move the map. The classes are pure, so a test
// can read what jsdom does not lay out.

export const CONSOLE_OVERLAY_LAYOUT = Object.freeze({
  float: Object.freeze({
    root: 'pointer-events-none absolute inset-0 z-10 grid grid-cols-[minmax(0,28rem)_minmax(0,1fr)_minmax(0,24rem)] '
      + 'grid-rows-[auto_minmax(0,1fr)_4.5rem_auto] gap-2 p-3',
    board: 'col-start-1 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col items-stretch',
    figures: 'col-start-2 row-start-1 flex min-w-0 justify-center',
    side: 'col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col gap-2',
    positions: 'col-span-3 row-start-4 flex min-w-0',
    // Each panel takes the pointer; folded, it shrinks to its pill.
    boardPanel: 'pointer-events-auto max-h-full data-[folded=true]:self-start',
    figuresPanel: 'pointer-events-auto w-full max-w-[44rem] data-[folded=true]:w-auto',
    alertsPanel: 'pointer-events-auto max-h-[55%] shrink-0 data-[folded=true]:self-end',
    alertsPanelAlone: 'pointer-events-auto max-h-full shrink-0 data-[folded=true]:self-end',
    inspectorPanel: 'pointer-events-auto min-h-0 max-h-full',
    positionsPanel: 'pointer-events-auto w-full data-[folded=true]:w-auto',
  }),
  // The figures first across the grid, then the board beside the alerts and the inspector, then the band across.
  grid: Object.freeze({
    root: 'grid min-w-0 grid-cols-1 content-start gap-2 p-2 lg:grid-cols-2',
    board: 'order-2 min-w-0',
    figures: 'order-1 min-w-0 lg:col-span-2',
    side: 'order-3 flex min-w-0 flex-col gap-2',
    positions: 'order-4 min-w-0 lg:col-span-2',
    boardPanel: 'max-h-[36rem]',
    figuresPanel: '',
    alertsPanel: 'max-h-[28rem]',
    alertsPanelAlone: 'max-h-[36rem]',
    inspectorPanel: 'max-h-[36rem]',
    positionsPanel: 'w-full',
  }),
});

/**
 * The panels in their places. `layout` is `float` (over the map) or `grid` (the fallback); `board`, `figures`, `alerts`,
 * `inspector` and `positions` are the panels, each already given its class of CONSOLE_OVERLAY_LAYOUT.
 */
export default function ConsoleOverlay({ layout = 'float', board, figures, alerts, inspector, positions }) {
  const classes = CONSOLE_OVERLAY_LAYOUT[layout] ?? CONSOLE_OVERLAY_LAYOUT.float;
  return (
    <div data-occ-console-panels={layout} className={classes.root}>
      <div className={classes.board}>{board}</div>
      <div className={classes.figures}>{figures}</div>
      <div className={classes.side}>
        {alerts}
        {inspector}
      </div>
      <div className={classes.positions}>{positions}</div>
    </div>
  );
}
