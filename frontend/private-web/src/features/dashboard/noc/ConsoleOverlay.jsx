'use client';

// Where the console's panels go (contratos 2.5, owner decision 15; CN-32 «Monitoreo OCC más profesional»). Over the map
// (`float`) the panels are docked flush against its edges, on the opaque panel slab with a 1 px joint where they meet
// the map, like the panes of an operations console:
// - the left column, the console's lists: «Tablero» over «Alertas» (with «Pendientes de la jornada»);
// - «Cifras de la jornada», one line of figures along the top of the map;
// - «Posiciones», the band of the stands along the bottom of the map;
// - the «Inspector» of the selection: from 1536 px (`wide`) a column of its own at the right of the map, between the
//   figures and the band, the place a flight panel of follow mode takes too; below 1536 px it docks in the left column
//   under «Tablero» and «Alertas» fold away while it is open (as Mapa de posiciones folds its list), so the map keeps
//   its width on a 1366 px laptop.
// The map's control rail (maps/ui/MapDock.jsx, placed by occ-map.css) runs down the right edge of the area the panels
// leave, inside the insets. A folded panel shrinks to its pill against its edge. In the fallback (`grid`), when the map
// engine cannot draw: the same panels as a plain grid beside the map's list. The panels are children of OccMap but
// never of MapLibre's container, so the band's arrows never move the map. The classes are pure, so a test can read what
// jsdom does not lay out.

// The joint of a docked pane on the side that meets the map, and the rounded corner of a pill that sticks out of it.
const LEFT_PANE = 'pointer-events-auto border-r border-occ-line';
const PILL_LEFT = 'data-[folded=true]:flex-none data-[folded=true]:self-start data-[folded=true]:rounded-br-md '
  + 'data-[folded=true]:border-b';

export const CONSOLE_OVERLAY_LAYOUT = Object.freeze({
  float: Object.freeze({
    root: 'pointer-events-none absolute inset-0 z-10 grid grid-cols-[24rem_minmax(0,1fr)] '
      + 'grid-rows-[auto_minmax(0,1fr)_auto] 2xl:grid-cols-[24rem_minmax(0,1fr)_auto] '
      + '3xl:grid-cols-[26rem_minmax(0,1fr)_auto]',
    lists: 'col-start-1 row-span-3 row-start-1 flex min-h-0 min-w-0 flex-col',
    figures: 'col-start-2 row-start-1 flex min-w-0 items-start 2xl:col-span-2',
    side: 'col-start-3 row-start-2 flex min-h-0 w-[22rem] min-w-0 flex-col items-stretch 3xl:w-[24rem]',
    positions: 'col-start-2 row-start-3 flex min-w-0 items-end 2xl:col-span-2',
    // Each panel takes the pointer; folded, it shrinks to its pill.
    boardPanel: `${LEFT_PANE} min-h-0 flex-1 basis-0 ${PILL_LEFT}`,
    figuresPanel: 'pointer-events-auto w-full border-b border-occ-line data-[folded=true]:w-auto '
      + 'data-[folded=true]:rounded-br-md data-[folded=true]:border-r',
    alertsPanel: `${LEFT_PANE} max-h-[40%] min-h-0 shrink-0 border-t ${PILL_LEFT}`,
    // Below 1536 px the inspector takes the place of «Alertas» in the left column while it is open.
    alertsPanelWithInspector: `${LEFT_PANE} max-h-[40%] min-h-0 shrink-0 border-t ${PILL_LEFT} max-2xl:hidden`,
    inspectorPanel: `${LEFT_PANE} min-h-0 flex-[1.35] basis-0 border-t ${PILL_LEFT}`,
    inspectorPanelWide: 'pointer-events-auto min-h-0 flex-1 border-l border-occ-line data-[folded=true]:flex-none '
      + 'data-[folded=true]:self-end data-[folded=true]:rounded-bl-md data-[folded=true]:border-b',
    positionsPanel: 'pointer-events-auto w-full border-t border-occ-line',
  }),
  // The figures first across the grid, then the board beside the alerts and the inspector, then the band across.
  grid: Object.freeze({
    root: 'grid min-w-0 grid-cols-1 content-start gap-2 p-2 lg:grid-cols-2',
    lists: 'order-2 flex min-w-0 flex-col gap-2',
    figures: 'order-1 min-w-0 lg:col-span-2',
    side: 'order-3 flex min-w-0 flex-col gap-2',
    positions: 'order-4 min-w-0 lg:col-span-2',
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
 * The panels in their places. `layout` is `float` (docked over the map) or `grid` (the fallback); `board`, `figures`,
 * `alerts`, `inspector` and `positions` are the panels, each already given its class of CONSOLE_OVERLAY_LAYOUT. `wide`
 * (from 1536 px) gives the inspector its own column at the right of the map; otherwise it docks under the board.
 */
export default function ConsoleOverlay({ layout = 'float', wide = false, board, figures, alerts, inspector, positions }) {
  const classes = CONSOLE_OVERLAY_LAYOUT[layout] ?? CONSOLE_OVERLAY_LAYOUT.float;
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
      </div>
    );
  }
  const sideInspector = wide && inspector;
  return (
    <div data-occ-console-panels={layout} data-occ-console-wide={wide ? 'true' : 'false'} className={classes.root}>
      <div className={classes.lists}>
        {board}
        {alerts}
        {sideInspector ? null : inspector}
      </div>
      <div className={classes.figures}>{figures}</div>
      {sideInspector ? <div data-occ-console-side="" className={classes.side}>{inspector}</div> : null}
      <div className={classes.positions}>{positions}</div>
    </div>
  );
}
