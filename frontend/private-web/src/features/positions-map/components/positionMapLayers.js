// Separa los datos de posición de su representación visual: este módulo solo construye el
// GeoJSON, las capas MapLibre (Source + Layers, con clustering nativo) y los handlers de
// interacción. PositionMap.jsx se limita a orquestar el ciclo de vida del mapa.
import { registerPositionIcons, POSITION_ICON_KEYS, SELECTION_RING_ICON_KEY } from './positionMarkerIcons';

export const SOURCE_ID = 'elevant-positions';
const CLUSTERS_LAYER = 'elevant-position-clusters';
const CLUSTER_COUNT_LAYER = 'elevant-position-cluster-count';
const POINTS_LAYER = 'elevant-position-points';
const LABELS_LAYER = 'elevant-position-labels';
const PRIORITY_LABELS_LAYER = 'elevant-position-priority-labels';
const SELECTED_LABEL_LAYER = 'elevant-position-selected-label';
const SELECTION_LAYER = 'elevant-position-selection';
// Los stands crecen con el zoom para seguir siendo legibles sobre la plataforma.
const STAND_ICON_SIZE = ['interpolate', ['linear'], ['zoom'], 14, 0.65, 16, 1, 18, 1.5];

// Tokens ya existentes en tailwind.config.js — ninguno nuevo.
const TERMINAL_CLUSTER_COLOR = { A: '#145DC4', B: '#0B1F3F', FBO: '#F2661E' };

export function toPositionsGeoJSON(positions) {
  return {
    type: 'FeatureCollection',
    features: positions.map(position => ({
      type: 'Feature',
      properties: { id: position.id, terminal: position.terminal, status: position.status, code: position.id },
      geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
    })),
  };
}

function terminalCountExpression(terminalId) {
  return ['+', ['case', ['==', ['get', 'terminal'], terminalId], 1, 0]];
}

export function attachPositionsLayers(map, { positions, selectedPositionId, onSelectPosition, onClusterExpand, theme = 'light', dashboardLabels = false }) {
  registerPositionIcons(map);

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: toPositionsGeoJSON(positions),
      cluster: true,
      clusterRadius: dashboardLabels ? 35 : 50,
      clusterMaxZoom: dashboardLabels ? 12 : 14,
      clusterProperties: {
        sumA: terminalCountExpression('A'),
        sumB: terminalCountExpression('B'),
        sumFBO: terminalCountExpression('FBO'),
      },
    });
  }

  if (!map.getLayer(CLUSTERS_LAYER)) {
    map.addLayer({
      id: CLUSTERS_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 16, 5, 20, 15, 26],
        'circle-color': [
          'case',
          ['all', ['>=', ['get', 'sumA'], ['get', 'sumB']], ['>=', ['get', 'sumA'], ['get', 'sumFBO']]],
          TERMINAL_CLUSTER_COLOR.A,
          ['>=', ['get', 'sumB'], ['get', 'sumFBO']],
          TERMINAL_CLUSTER_COLOR.B,
          TERMINAL_CLUSTER_COLOR.FBO,
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#FFFFFF',
      },
    });
  }

  if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
    map.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
      },
      paint: { 'text-color': '#FFFFFF' },
    });
  }

  if (!map.getLayer(POINTS_LAYER)) {
    map.addLayer({
      id: POINTS_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': [
          'match',
          ['get', 'status'],
          'planned',
          POSITION_ICON_KEYS.planned,
          'unverified',
          POSITION_ICON_KEYS.unverified,
          'occupied',
          POSITION_ICON_KEYS.occupied,
          'disabled',
          POSITION_ICON_KEYS.disabled,
          'releasing',
          POSITION_ICON_KEYS.releasing,
          POSITION_ICON_KEYS.available,
        ],
        'icon-size': STAND_ICON_SIZE,
        'icon-allow-overlap': true,
      },
    });
  }

  if (!map.getLayer(LABELS_LAYER)) {
    map.addLayer({
      id: LABELS_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      filter: dashboardLabels
        ? ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'status'], 'planned']]
        : ['!', ['has', 'point_count']],
      minzoom: dashboardLabels ? 12.8 : 15,
      layout: {
        'text-field': ['get', 'code'],
        'text-font': ['Noto Sans Bold'],
        'text-size': dashboardLabels ? ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 12] : 10,
        'text-offset': [0, dashboardLabels ? 1.9 : 1.6],
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': theme === 'dark' ? '#F2F7FF' : '#09213D',
        'text-halo-color': theme === 'dark' ? '#071827' : '#FFFFFF',
        'text-halo-width': dashboardLabels ? 2 : 1.2,
      },
    });
  }

  if (!map.getLayer(SELECTION_LAYER)) {
    map.addLayer({
      id: SELECTION_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'id'], selectedPositionId ?? '__none__'],
      layout: { 'icon-image': SELECTION_RING_ICON_KEY, 'icon-size': STAND_ICON_SIZE, 'icon-allow-overlap': true },
    });
  }

  if (dashboardLabels && !map.getLayer(PRIORITY_LABELS_LAYER)) {
    map.addLayer({ id: PRIORITY_LABELS_LAYER, type: 'symbol', source: SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'status'], 'planned']],
      minzoom: 12.5,
      layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 17, 13],
        'text-offset': [0, 2], 'text-allow-overlap': true, 'text-optional': false },
      paint: { 'text-color': theme === 'dark' ? '#A8D7FF' : '#0755A8',
        'text-halo-color': theme === 'dark' ? '#071827' : '#FFFFFF', 'text-halo-width': 2.3 },
    });
  }
  if (dashboardLabels && !map.getLayer(SELECTED_LABEL_LAYER)) {
    map.addLayer({ id: SELECTED_LABEL_LAYER, type: 'symbol', source: SOURCE_ID,
      filter: ['==', ['get', 'id'], selectedPositionId ?? '__none__'],
      layout: { 'text-field': ['get', 'code'], 'text-font': ['Noto Sans Bold'],
        'text-size': 14, 'text-offset': [0, 2.1], 'text-allow-overlap': true },
      paint: { 'text-color': theme === 'dark' ? '#FFFFFF' : '#08203C',
        'text-halo-color': theme === 'dark' ? '#071827' : '#FFFFFF', 'text-halo-width': 2.5 },
    });
  }

  function handlePointClick(event) {
    const feature = event.features?.[0];
    if (feature) onSelectPosition(feature.properties.id);
  }

  function handleClusterClick(event) {
    const feature = event.features?.[0];
    if (!feature) return;
    const source = map.getSource(SOURCE_ID);
    source.getClusterExpansionZoom(feature.properties.cluster_id, (error, zoom) => {
      if (error) return;
      map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 500 });
      onClusterExpand?.();
    });
  }

  function setPointerCursor() {
    map.getCanvas().style.cursor = 'pointer';
  }

  function resetCursor() {
    map.getCanvas().style.cursor = '';
  }

  map.on('click', POINTS_LAYER, handlePointClick);
  map.on('click', CLUSTERS_LAYER, handleClusterClick);
  map.on('mouseenter', POINTS_LAYER, setPointerCursor);
  map.on('mouseleave', POINTS_LAYER, resetCursor);
  map.on('mouseenter', CLUSTERS_LAYER, setPointerCursor);
  map.on('mouseleave', CLUSTERS_LAYER, resetCursor);

  return () => {
    map.off('click', POINTS_LAYER, handlePointClick);
    map.off('click', CLUSTERS_LAYER, handleClusterClick);
    map.off('mouseenter', POINTS_LAYER, setPointerCursor);
    map.off('mouseleave', POINTS_LAYER, resetCursor);
    map.off('mouseenter', CLUSTERS_LAYER, setPointerCursor);
    map.off('mouseleave', CLUSTERS_LAYER, resetCursor);
  };
}

export function updatePositionsData(map, positions) {
  const source = map.getSource(SOURCE_ID);
  if (source) source.setData(toPositionsGeoJSON(positions));
}

export function setSelectedPositionFilter(map, selectedPositionId) {
  if (map.getLayer(SELECTION_LAYER)) {
    map.setFilter(SELECTION_LAYER, ['==', ['get', 'id'], selectedPositionId ?? '__none__']);
  }
  if (map.getLayer(SELECTED_LABEL_LAYER)) {
    map.setFilter(SELECTED_LABEL_LAYER, ['==', ['get', 'id'], selectedPositionId ?? '__none__']);
  }
}
