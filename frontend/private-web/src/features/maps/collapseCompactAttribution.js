// MapLibre 6 starts compact attribution <details> expanded. On a small OCC
// map this obscures the imagery; keep the native disclosure available but
// start it closed. The panel footer still names each data source.
export function collapseCompactAttribution(map) {
  const summary = map.getContainer().querySelector('details.maplibregl-ctrl-attrib[open] > summary');
  summary?.click();
}
