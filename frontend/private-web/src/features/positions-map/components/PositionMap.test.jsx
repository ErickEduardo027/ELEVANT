import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  Map: class { constructor() { throw new Error('WebGL unavailable'); } },
  NavigationControl: class {},
  AttributionControl: class {},
  LngLatBounds: class {},
}));

import PositionMap from './PositionMap';

describe('PositionMap fallback', () => {
  it('offers selectable positions when WebGL or the map provider fails', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(<PositionMap positions={[{ id: 'A5', latitude: 18.5, longitude: -68.3 }]}
      selectedPositionId={null} onSelectPosition={select} theme="light" viewMode="2d" />);
    expect(screen.getByRole('alert')).toHaveTextContent('La cartografía no está disponible');
    await user.click(screen.getByRole('button', { name: 'A5' }));
    expect(select).toHaveBeenCalledWith('A5');
  });
});
