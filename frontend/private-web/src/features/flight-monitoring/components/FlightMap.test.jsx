import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { __state } from 'maplibre-gl';
import FlightMap from './FlightMap';

vi.mock('maplibre-gl', () => {
  const state = { maps: [], workerUrl: null, failConstructor: false };

  class FakeMarker {
    constructor(options) {
      this.element = options.element;
      this.lngLat = null;
      this.removed = false;
    }
    setLngLat(lngLat) {
      this.lngLat = lngLat;
      return this;
    }
    addTo(map) {
      this.map = map;
      map.markers.push(this);
      return this;
    }
    remove() {
      this.removed = true;
      this.map.markers = this.map.markers.filter(marker => marker !== this);
    }
  }

  class FakeMap {
    constructor(options) {
      if (state.workerUrl !== '/assets/maplibre/maplibre-gl-worker.mjs') {
        throw new Error('MapLibre worker URL must be configured before creating a map');
      }
      if (state.failConstructor) {
        // MapLibre 6.7+ throws GPUInitializationError from the constructor when WebGL2 is missing.
        throw new Error('Failed to initialize WebGL2');
      }
      this.options = options;
      this.markers = [];
      this.controls = [];
      this.styleCalls = [];
      this.flyToCalls = [];
      this.fitBoundsCalls = [];
      this.listeners = {};
      state.maps.push(this);
    }
    addControl(control) {
      this.controls.push(control);
    }
    setStyle(style) {
      this.styleCalls.push(style);
    }
    flyTo(options) {
      this.flyToCalls.push(options);
    }
    fitBounds(bounds, options) {
      this.fitBoundsCalls.push({ bounds: bounds.toArray(), options });
    }
    on(event, handler) {
      (this.listeners[event] ??= []).push(handler);
    }
    off(event, handler) {
      this.listeners[event] = (this.listeners[event] ?? []).filter(existing => existing !== handler);
    }
    emit(event) {
      (this.listeners[event] ?? []).forEach(handler => handler());
    }
    // Fixed, deterministic stand-in for MapLibre's real screen-space projection —
    // good enough to prove FlightMap calls it with the right lngLat and forwards the result.
    project([lng, lat]) {
      return { x: lng * 10, y: lat * 10 };
    }
    remove() {
      this.removed = true;
    }
  }

  class FakeNavigationControl {}

  class FakeLngLatBounds {
    constructor(sw, ne) {
      this._sw = sw ? [...sw] : null;
      this._ne = ne ? [...ne] : null;
    }
    extend([lng, lat]) {
      if (!this._sw || !this._ne) {
        this._sw = [lng, lat];
        this._ne = [lng, lat];
      } else {
        this._sw = [Math.min(this._sw[0], lng), Math.min(this._sw[1], lat)];
        this._ne = [Math.max(this._ne[0], lng), Math.max(this._ne[1], lat)];
      }
      return this;
    }
    toArray() {
      return [this._sw, this._ne];
    }
  }

  return {
    Map: FakeMap,
    Marker: FakeMarker,
    NavigationControl: FakeNavigationControl,
    LngLatBounds: FakeLngLatBounds,
    setWorkerUrl: url => { state.workerUrl = url; },
    __state: state,
  };
});

function flight(overrides) {
  return { id: 1, status: 'approaching', heading: 90, latitude: 18.78, longitude: -68.12, ...overrides };
}

describe('FlightMap', () => {
  beforeEach(() => {
    __state.maps.length = 0;
    __state.workerUrl = null;
    __state.failConstructor = false;
    cleanup();
  });

  it('keeps the page and says the map is unavailable when the map cannot start (no WebGL2)', () => {
    __state.failConstructor = true;
    const { getByRole, queryByLabelText, getByTestId } = render(
      <FlightMap flights={[flight({ id: 1 })]} selectedFlightId={1} onSelectFlight={() => {}} theme="light" />
    );
    expect(__state.maps).toHaveLength(0);
    expect(getByRole('alert')).toHaveTextContent('El mapa no está disponible en este navegador');
    expect(getByTestId('flight-map-container')).toBeInTheDocument();
    expect(queryByLabelText('Restablecer vista')).toBeNull();
    expect(queryByLabelText('Centrar PUJ')).toBeNull();
  });

  it('mounts a map centered on PUJ with the navigation control and the airport marker', () => {
    render(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    const map = __state.maps[0];
    expect(__state.workerUrl).toBe('/assets/maplibre/maplibre-gl-worker.mjs');
    expect(map.options.center).toEqual([-68.3634, 18.5674]);
    expect(map.controls).toHaveLength(1);
    expect(map.markers).toHaveLength(1); // airport marker only
  });

  it('creates one aircraft marker per flight and calls onSelectFlight when its element is clicked', () => {
    const onSelectFlight = vi.fn();
    render(
      <FlightMap flights={[flight({ id: 1 }), flight({ id: 2 })]} selectedFlightId={null} onSelectFlight={onSelectFlight} theme="light" />
    );
    const map = __state.maps[0];
    expect(map.markers).toHaveLength(3); // airport + 2 aircraft

    const aircraftMarker = map.markers.find(marker => marker.element.dataset.flightId === '1');
    // The marker element is created imperatively and handed to MapLibre — it never joins the
    // RTL render tree, so it must be dispatched to directly rather than via screen/userEvent.
    aircraftMarker.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelectFlight).toHaveBeenCalledWith(1);
  });

  it('moves an existing marker instead of recreating it when the flight position changes', () => {
    const { rerender } = render(
      <FlightMap flights={[flight({ id: 1, latitude: 18.78, longitude: -68.12 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    const map = __state.maps[0];
    expect(map.markers).toHaveLength(2);

    rerender(
      <FlightMap flights={[flight({ id: 1, latitude: 18.8, longitude: -68.1 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    expect(map.markers).toHaveLength(2); // no new marker created
    const aircraftMarker = map.markers.find(marker => marker.element.dataset.flightId === '1');
    expect(aircraftMarker.lngLat).toEqual([-68.1, 18.8]);
  });

  it('removes a marker when its flight disappears from the flights array', () => {
    const { rerender } = render(
      <FlightMap flights={[flight({ id: 1 }), flight({ id: 2 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    const map = __state.maps[0];
    expect(map.markers).toHaveLength(3);

    rerender(<FlightMap flights={[flight({ id: 1 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    expect(map.markers).toHaveLength(2);
    expect(map.markers.some(marker => marker.element.dataset.flightId === '2')).toBe(false);
  });

  it('re-adds markers to a fresh map instance after unmount/remount, without stranding them on the old map (StrictMode double-invoke)', () => {
    const { unmount } = render(
      <FlightMap flights={[flight({ id: 1 }), flight({ id: 2 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    const firstMap = __state.maps[0];
    expect(firstMap.markers).toHaveLength(3); // airport + 2 aircraft

    unmount();
    // Cleanup must remove the aircraft markers (not just the airport marker) from the old map.
    expect(firstMap.markers).toHaveLength(0);

    render(
      <FlightMap flights={[flight({ id: 1 }), flight({ id: 2 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />
    );
    const secondMap = __state.maps[1];
    // Without clearing markersRef on cleanup, the diffing effect would think these markers
    // already exist (pointing at the destroyed firstMap) and never create them on secondMap.
    expect(secondMap.markers).toHaveLength(3);
  });

  it('calls map.setStyle exactly once when the theme prop changes', () => {
    const { rerender } = render(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    const map = __state.maps[0];
    expect(map.styleCalls).toHaveLength(0);

    rerender(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="dark" />);
    expect(map.styleCalls).toHaveLength(1);
  });

  it('flies to PUJ when "Centrar PUJ" is clicked', async () => {
    const { getByLabelText } = render(<FlightMap flights={[]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" />);
    const map = __state.maps[0];

    await userEvent.click(getByLabelText('Centrar PUJ'));
    expect(map.flyToCalls.at(-1).center).toEqual([-68.3634, 18.5674]);
    expect(map.flyToCalls.at(-1).zoom).toBe(9);
  });

  it('fits the map to bounds covering all visible flights plus PUJ when "Restablecer vista" is clicked', async () => {
    const { getByLabelText } = render(
      <FlightMap
        flights={[flight({ id: 1, latitude: 18.78, longitude: -68.12 }), flight({ id: 2, latitude: 19.5, longitude: -69.9 })]}
        selectedFlightId={null}
        onSelectFlight={() => {}}
        theme="light"
      />
    );
    const map = __state.maps[0];

    await userEvent.click(getByLabelText('Restablecer vista'));

    // Bounds cover PUJ (-68.3634, 18.5674) plus both flights (-68.12, 18.78) and (-69.9, 19.5).
    expect(map.fitBoundsCalls).toHaveLength(1);
    expect(map.fitBoundsCalls[0].bounds).toEqual([
      [-69.9, 18.5674],
      [-68.12, 19.5],
    ]);
    expect(map.fitBoundsCalls[0].options).toEqual({ padding: 60 });
  });

  it('reports the projected screen position of the selected flight via onPopoverPosition', () => {
    const onPopoverPosition = vi.fn();
    render(
      <FlightMap
        flights={[flight({ id: 1, latitude: 18.78, longitude: -68.12 })]}
        selectedFlightId={1}
        onSelectFlight={() => {}}
        theme="light"
        onPopoverPosition={onPopoverPosition}
      />
    );
    // FakeMap.project([lng, lat]) => { x: lng * 10, y: lat * 10 } (see mock above).
    expect(onPopoverPosition).toHaveBeenCalledWith({ left: -681.2, top: 187.8 });
  });

  it('reports null when nothing is selected', () => {
    const onPopoverPosition = vi.fn();
    render(
      <FlightMap flights={[flight({ id: 1 })]} selectedFlightId={null} onSelectFlight={() => {}} theme="light" onPopoverPosition={onPopoverPosition} />
    );
    expect(onPopoverPosition).toHaveBeenCalledWith(null);
  });

  it('recomputes the popover position when the map fires a move or zoom event', () => {
    const onPopoverPosition = vi.fn();
    render(
      <FlightMap
        flights={[flight({ id: 1, latitude: 18.78, longitude: -68.12 })]}
        selectedFlightId={1}
        onSelectFlight={() => {}}
        theme="light"
        onPopoverPosition={onPopoverPosition}
      />
    );
    const map = __state.maps[0];
    onPopoverPosition.mockClear();

    map.emit('move');
    expect(onPopoverPosition).toHaveBeenCalledWith({ left: -681.2, top: 187.8 });
  });
});
