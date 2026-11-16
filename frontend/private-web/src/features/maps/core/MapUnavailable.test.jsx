import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MapUnavailable from './MapUnavailable';

const ITEMS = [{ id: 'A1', label: 'A1' }, { id: 'B21', label: 'B21' }, { id: 'BN6', label: 'BN6', kind: 'stand' }];

afterEach(cleanup);

describe('MapUnavailable', () => {
  it('renders an alert with a selectable list and reports the chosen item', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<MapUnavailable title="La cartografía no está disponible"
      description="Puedes consultar y seleccionar las posiciones desde esta lista mientras se restablece el mapa base."
      listLabel="Lista del mapa" items={ITEMS} selectedId="B21" onSelect={onSelect} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-testid', 'map-unavailable');
    expect(within(alert).getByRole('heading', { level: 3, name: 'La cartografía no está disponible' })).toBeInTheDocument();
    expect(within(alert).getByText(/Puedes consultar y seleccionar las posiciones/)).toBeInTheDocument();
    const list = within(alert).getByRole('group', { name: 'Lista del mapa' });
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['A1', 'B21', 'BN6']);
    expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // 44 px targets, on tokens only.
    for (const button of buttons) expect(button.className).toMatch(/\bmin-h-11\b/);

    fireEvent.click(within(list).getByRole('button', { name: 'BN6' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('BN6', ITEMS[2]);

    // English strings come from the adapter as well; without items there is no list.
    rerender(<MapUnavailable title="Base map unavailable" description="You can browse and select stands from this list."
      listLabel="Map list" items={[]} />);
    expect(screen.getByRole('heading', { name: 'Base map unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});
