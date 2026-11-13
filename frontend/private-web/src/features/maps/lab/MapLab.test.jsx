import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { standPoint } from '../testing/mapFixtures';
import MapLab, { MAP_LAB_MARKER } from './MapLab';
import { SCENES } from './scenes';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
const NOON = '2026-11-13T15:00:00Z';
const query = () => new URLSearchParams(window.location.search);

function open(search, { strict = false } = {}) {
  window.history.replaceState({}, '', `/map-lab${search}`);
  const view = render(strict ? <StrictMode><MapLab /></StrictMode> : <MapLab />);
  return { ...view, map: fake.state.liveMaps().at(-1) ?? null };
}

const loadStyle = map => act(() => fake.state.emit(map, 'style.load'));
const fnCalls = name => fake.state.calls.filter(call => call.fn === name);

beforeEach(() => {
  fake.state.reset();
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

describe('MapLab', () => {
  it('lists every scene when the URL names none, and says so for an unknown one', () => {
    open('');
    const root = document.querySelector(`[${MAP_LAB_MARKER}]`);
    expect(root).toHaveAttribute(MAP_LAB_MARKER, 'v1');
    expect(root).toHaveAttribute('data-department', 'occ');
    expect(root).toHaveClass('dark', 'bg-occ-canvas');
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratorio de mapas' })).toBeInTheDocument();
    const links = within(screen.getByRole('list', { name: 'Escenas' })).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual(SCENES.map(scene => `/map-lab?scene=${scene.id}`));
    expect(links[0]).toHaveTextContent(SCENES[0].title);
    expect(fake.state.maps).toEqual([]);
    cleanup();

    open('?scene=nope');
    expect(screen.getByRole('status')).toHaveTextContent('No existe la escena «nope». Elige una de la lista.');
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(SCENES.length);
  });

  it('mounts the map with the scene, its title and the test-data notice, and freezes the map clock with t=', () => {
    const { map, unmount } = open(`?scene=ramp-points&t=${NOON}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Rampa: posiciones y estados' })).toBeInTheDocument();
    expect(screen.getByText('Datos de prueba, no oficiales')).toBeInTheDocument();
    expect(screen.getByText('Reloj fijo: 2026-11-13 15:00 UTC')).toBeInTheDocument();
    // The clock is frozen before the map starts, and the map starts without symbol fades.
    const order = fake.state.calls.map(call => call.fn);
    expect(order.indexOf('setNow')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('setNow')).toBeLessThan(order.indexOf('Map'));
    expect(fnCalls('setNow')[0].args).toEqual([Date.parse(NOON)]);
    expect(map.options.fadeDuration).toBe(0);
    expect(map.options.style.sources).toHaveProperty('openmaptiles');
    expect(screen.getByTestId('map-lab-map').querySelector('.maplibregl-canvas')).not.toBeNull();

    loadStyle(map);
    expect(map.getSource('occ-stands').data.features).toHaveLength(41);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'ramp');
    expect(screen.getByRole('group', { name: 'Vista del mapa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leyenda' })).toBeInTheDocument();

    unmount();
    expect(fnCalls('restoreNow')).toHaveLength(1);
    expect(fake.state.liveMaps()).toEqual([]);
  });

  it('draws without the vector tiles with basemap=none and keeps the clock running without t=', () => {
    const { map } = open('?scene=airfield&basemap=none');
    expect(map.options.style.sources).not.toHaveProperty('openmaptiles');
    expect(map.options.fadeDuration).toBe(150);
    expect(fnCalls('setNow')).toEqual([]);
    expect(screen.getByText('Sin mapa base')).toBeInTheDocument();
    loadStyle(map);
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-view', 'airfield');
    expect(screen.getByTestId('occ-map')).toHaveAttribute('data-occ-basemap', 'off');
  });

  it('writes the scene selection to the URL once and follows the URL after that', () => {
    const { map } = open('?scene=ramp-selected&stationId=s-1');
    expect(query().get('stand')).toBe('A5');
    expect(query().get('stationId')).toBe('s-1');
    loadStyle(map);
    expect(map.getSource('occ-selection').data.features[0].properties).toEqual({ kind: 'stand', id: 'A5' });
    // Esc clears it, and the scene does not select it again.
    fireEvent.keyDown(map.getCanvas(), { key: 'Escape' });
    expect(query().has('stand')).toBe(false);
    expect(map.getSource('occ-selection').data.features).toEqual([]);
    // A stand clicked on the map is the selection.
    fake.state.setRenderedFeatures(map, () => [{ layer: { id: 'occ-stands-frame' }, properties: { code: 'B21' } }]);
    act(() => fake.state.emit(map, 'click', { point: { x: 10, y: 10 }, lngLat: { lng: -68.369, lat: 18.563 } }));
    expect(query().get('stand')).toBe('B21');
  });

  it('re-reads the same stands without a new map or a new write, and exposes the lab handle', async () => {
    const { map, unmount } = open('?scene=ramp-points', { strict: true });
    loadStyle(map);
    expect(fake.state.liveMaps()).toEqual([map]);
    const source = map.getSource('occ-stands');
    expect(source.setDataCalls).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Releer posiciones' }));
    act(() => window.__occMapLab.refresh());
    expect(fake.state.liveMaps()).toEqual([map]);
    expect(source.setDataCalls).toHaveLength(1);

    const lab = window.__occMapLab;
    expect(lab.scene).toBe('ramp-points');
    expect(lab.liveMaps()).toBe(1);
    expect(lab.getCamera()).toMatchObject({ zoom: map.getZoom() });
    act(() => lab.flyToPreset('ramp', { terminal: 'FBO' }));
    act(() => map.jumpTo({ center: standPoint('BN6') }));
    expect(lab.project(standPoint('BN6'))).toEqual({ x: 720, y: 450 });
    // A stand of the scene by its code; an unknown code has no pixel.
    expect(lab.project('BN6')).toEqual({ x: 720, y: 450 });
    expect(lab.project('Z9')).toBeNull();
    const idle = lab.whenIdle();
    act(() => fake.state.emit(map, 'idle'));
    await expect(idle).resolves.toBe(true);

    unmount();
    expect(window.__occMapLab).toBeUndefined();
  });

  it('refuses WebGL while the fallback scene is open and gives it back after', () => {
    const original = HTMLCanvasElement.prototype.getContext;
    const spy = vi.fn(() => 'context-2d');
    HTMLCanvasElement.prototype.getContext = spy;
    try {
      const { unmount } = open('?scene=unavailable-fallback');
      const patched = HTMLCanvasElement.prototype.getContext;
      expect(patched).not.toBe(spy);
      const canvas = document.createElement('canvas');
      for (const type of ['webgl2', 'webgl', 'experimental-webgl']) expect(canvas.getContext(type)).toBeNull();
      expect(canvas.getContext('2d', { willReadFrequently: true })).toBe('context-2d');
      expect(spy).toHaveBeenCalledExactlyOnceWith('2d', { willReadFrequently: true });
      unmount();
      expect(HTMLCanvasElement.prototype.getContext).toBe(spy);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
    }
  });

  it('cuts every base-map request of the degraded scene through a protocol of its own', async () => {
    const { map, unmount } = open('?scene=basemap-degraded');
    expect(fnCalls('addProtocol')[0].args).toEqual(['occ-lab-cut']);
    const { transformRequest } = map.options;
    expect(transformRequest('https://tiles.openfreemap.org/planet', 'Source')).toEqual({ url: 'occ-lab-cut://basemap' });
    expect(transformRequest('https://tiles.openfreemap.org/planet/20261101_001001_pt/14/4968/7226.pbf', 'Tile'))
      .toEqual({ url: 'occ-lab-cut://basemap' });
    // Glyphs and everything else are left as they are.
    expect(transformRequest('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Bold/0-255.pbf', 'Glyphs')).toBeUndefined();
    await expect(fake.state.protocols.get('occ-lab-cut')({ url: 'occ-lab-cut://basemap' })).rejects.toThrow();

    loadStyle(map);
    act(() => fake.state.emit(map, 'error', { sourceId: 'openmaptiles', error: new Error('The map lab cut the base map.') }));
    expect(screen.getByRole('status')).toHaveTextContent('No se pudo cargar el mapa base.');
    unmount();
    expect(fnCalls('removeProtocol')[0].args).toEqual(['occ-lab-cut']);
    expect(fake.state.protocols.size).toBe(0);
  });

  it('uses only occ-* classes', async () => {
    const { readSource } = await import('../../../styles/occSourceScan');
    const { findLegacyColourClasses } = await import('../../../styles/occLegacyBridge');
    for (const file of ['src/features/maps/lab/MapLab.jsx', 'app/map-lab/MapLabLoader.jsx']) {
      const source = readSource(file);
      expect(findLegacyColourClasses(source), file).toEqual([]);
      expect(source.match(/-occ-[a-z-]+\/(?:\d+|\[)/g), file).toBeNull();
      expect(source, file).not.toMatch(/backdrop|gradient|\bblur\b|\bshadow-(?!none\b)|(?<![\w-])ring-/);
    }
  });
});
