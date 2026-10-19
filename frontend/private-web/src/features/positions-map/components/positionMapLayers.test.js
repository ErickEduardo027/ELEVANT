import { describe, expect, it, vi } from 'vitest';

vi.mock('./positionMarkerIcons', () => ({
  registerPositionIcons: vi.fn(),
  POSITION_ICON_KEYS: { planned: 'planned', unverified: 'unverified', occupied: 'occupied',
    disabled: 'disabled', releasing: 'releasing', available: 'available' },
  SELECTION_RING_ICON_KEY: 'selection-ring',
}));

import { attachPositionsLayers, setSelectedPositionFilter } from './positionMapLayers';

function fakeMap() {
  const layers = new Map();
  const sources = new Map();
  return {
    layers, sources, setFilter: vi.fn(),
    getLayer: id => layers.get(id), addLayer: layer => layers.set(layer.id, layer),
    getSource: id => sources.get(id), addSource: (id, source) => sources.set(id, source),
    on: vi.fn(), off: vi.fn(),
  };
}

describe('dashboard MapLibre stand labels', () => {
  it('keeps permanent in-map labels, prioritizes planned and selected stands, and uses dark palette', () => {
    const map = fakeMap();
    attachPositionsLayers(map, { positions: [{ id: 'B34', terminal: 'B', latitude: 18.56,
      longitude: -68.37, status: 'planned' }], selectedPositionId: 'B34',
    onSelectPosition: vi.fn(), theme: 'dark', dashboardLabels: true });
    expect(map.sources.get('elevant-positions')).toMatchObject({ clusterMaxZoom: 12, clusterRadius: 35 });
    expect(map.layers.get('elevant-position-labels').minzoom).toBeLessThan(13);
    expect(map.layers.get('elevant-position-labels').paint['text-color']).toBe('#F2F7FF');
    expect(map.layers.get('elevant-position-priority-labels').filter).toContainEqual(['==', ['get', 'status'], 'planned']);
    expect(map.layers.get('elevant-position-selected-label').layout['text-allow-overlap']).toBe(true);
    setSelectedPositionFilter(map, 'A1');
    expect(map.setFilter).toHaveBeenCalledWith('elevant-position-selected-label', ['==', ['get', 'id'], 'A1']);
  });
});
