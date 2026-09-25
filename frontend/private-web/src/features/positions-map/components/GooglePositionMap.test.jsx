import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GooglePositionMap from './GooglePositionMap';
import { loadGoogleMap } from '../../maps/googleMapsLoader';

vi.mock('../../maps/googleMapsLoader', () => ({ loadGoogleMap: vi.fn() }));

const mapOptions = [];
const markers = [];
const maps = {
  Map: class {
    constructor(_element, options) { mapOptions.push(options); }
    setTilt() {}
    panTo() {}
    setZoom() {}
    getZoom() { return 15; }
    fitBounds() {}
    setHeading() {}
  },
  Marker: class {
    constructor(options) { this.options = options; markers.push(this); }
    setMap() {}
    addListener(_event, listener) { this.click = listener; }
  },
  LatLngBounds: class { extend() {} },
  SymbolPath: { CIRCLE: 'circle' },
  event: {
    addListenerOnce: (_map, _name, listener) => { listener(); return { remove() {} }; },
    clearInstanceListeners() {},
  },
};

beforeEach(() => {
  mapOptions.length = 0;
  markers.length = 0;
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'synthetic-browser-key');
  vi.mocked(loadGoogleMap).mockResolvedValue(maps);
});

afterEach(() => vi.unstubAllEnvs());

describe('GooglePositionMap', () => {
  it('creates dark and light maps and keeps position selection interactive', async () => {
    const select = vi.fn();
    const position = { id: 'A01', latitude: 18.57, longitude: -68.36, status: 'occupied' };
    const { rerender } = render(<GooglePositionMap positions={[position]}
      selectedPositionId={null} onSelectPosition={select} theme="dark" viewMode="2d" />);

    expect(screen.getByTestId('google-position-map-container')).toBeInTheDocument();
    await waitFor(() => expect(markers.length).toBeGreaterThan(0));
    expect(mapOptions[0].colorScheme).toBe('DARK');
    expect(markers.at(-1).options.title).toBe('Posición A01');
    markers.at(-1).click();
    expect(select).toHaveBeenCalledWith('A01');

    rerender(<GooglePositionMap positions={[position]} selectedPositionId="A01"
      onSelectPosition={select} theme="light" viewMode="2d" />);
    await waitFor(() => expect(mapOptions.at(-1).colorScheme).toBe('LIGHT'));
  });

  it('offers a selectable fallback when Google cannot load', async () => {
    vi.mocked(loadGoogleMap).mockRejectedValue(new Error('not available'));
    const select = vi.fn();
    render(<GooglePositionMap positions={[{ id: 'A01', latitude: 18.57, longitude: -68.36 }]}
      selectedPositionId={null} onSelectPosition={select} theme="light" viewMode="2d" />);

    await screen.findByRole('alert');
    await userEvent.setup().click(screen.getByRole('button', { name: 'A01' }));
    expect(select).toHaveBeenCalledWith('A01');
  });
});
