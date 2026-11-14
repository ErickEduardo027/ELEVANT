import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OccSegmented, { OCC_SEGMENTED_KINDS, OCC_SEGMENTED_SIZES } from './OccSegmented';

afterEach(cleanup);

const BOARD = [
  { id: 'arrivals', label: 'Llegadas', count: 4 },
  { id: 'departures', label: 'Salidas', count: 3 },
  { id: 'turnarounds', label: 'Escalas', count: 7 },
];

const classesOf = element => element.className.split(/\s+/).filter(Boolean);

// The board as the console will hold it: the tabs and the panel they switch.
function Tabs({ options = BOARD, initial = 'arrivals', onChange }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <button type="button">Antes</button>
      <OccSegmented as="tablist" label="Tablero" options={options} value={value}
        onChange={id => { setValue(id); onChange?.(id); }} panelIdFor={id => `board-${id}`} tabIdFor={id => `board-tab-${id}`} />
      <div role="tabpanel" id={`board-${value}`} aria-labelledby={`board-tab-${value}`}>{value}</div>
    </>
  );
}

describe('OccSegmented', () => {
  it('as a group, its buttons say aria-pressed and call onChange; disabled options cannot be chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    expect(OCC_SEGMENTED_KINDS).toEqual(['group', 'tablist']);
    expect(OCC_SEGMENTED_SIZES).toEqual(['md', 'sm']);
    render(
      <OccSegmented label="Ventana" value="8h" onChange={onChange} className="ml-auto"
        options={[{ id: '4h', label: '4 h' }, { id: '8h', label: '8 h' }, { id: 'day', label: 'Día' },
          { id: 'now', label: 'Ahora', disabled: true }]} />,
    );
    const group = screen.getByRole('group', { name: 'Ventana' });
    expect(classesOf(group).at(-1)).toBe('ml-auto');
    expect(within(group).getByRole('button', { name: '8 h' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: '4 h' })).toHaveAttribute('aria-pressed', 'false');
    // Chosen in cyan on its soft slab; the rest carries no hue.
    expect(classesOf(within(group).getByRole('button', { name: '8 h' }))).toEqual(
      expect.arrayContaining(['bg-occ-accent-soft', 'text-occ-accent']));
    expect(classesOf(within(group).getByRole('button', { name: '4 h' }))).not.toContain('text-occ-accent');
    // Every option is its own stop for Tab, as the screens' filters are today.
    for (const button of within(group).getAllByRole('button')) expect(button).not.toHaveAttribute('tabindex');

    await user.click(within(group).getByRole('button', { name: 'Día' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('day');
    // Choosing what is already chosen says nothing; a disabled option cannot be chosen at all.
    await user.click(within(group).getByRole('button', { name: '8 h' }));
    const disabled = within(group).getByRole('button', { name: 'Ahora' });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onChange).toHaveBeenCalledTimes(1);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccSegmented label="Ventana" options={[]} as="radiogroup" />)).toThrow(RangeError);
      expect(() => render(<OccSegmented label="Ventana" options={[]} size="lg" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('as a tablist, arrows, Home and End move and choose, with one tab stop and aria-controls', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs onChange={onChange} options={[...BOARD.slice(0, 2), { ...BOARD[2], disabled: true },
      { id: 'toImport', label: 'Por importar', count: 1 }]} />);
    const tablist = screen.getByRole('tablist', { name: 'Tablero' });
    const tab = name => within(tablist).getByRole('tab', { name });
    // The count is part of the name, in Manrope with tabular figures: never mono, because it is not an identifier.
    expect(tab('Llegadas 4')).toHaveAttribute('aria-selected', 'true');
    expect(within(tab('Llegadas 4')).getByText('4')).toHaveClass('text-xs', 'font-medium', 'tabular-nums');
    expect(within(tab('Llegadas 4')).getByText('4')).not.toHaveClass('font-mono');
    expect(tab('Llegadas 4')).toHaveAttribute('aria-controls', 'board-arrivals');
    expect(tab('Llegadas 4')).toHaveAttribute('id', 'board-tab-arrivals');
    expect(screen.getByRole('tabpanel', { name: 'Llegadas 4' })).toHaveTextContent('arrivals');
    // One stop for Tab: the chosen tab.
    expect(within(tablist).getAllByRole('tab').map(item => item.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);

    await user.click(screen.getByRole('button', { name: 'Antes' }));
    await user.tab();
    expect(tab('Llegadas 4')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Salidas 3')).toHaveFocus();
    expect(tab('Salidas 3')).toHaveAttribute('aria-selected', 'true');
    expect(onChange).toHaveBeenLastCalledWith('departures');
    // A disabled tab is skipped.
    await user.keyboard('{ArrowRight}');
    expect(tab('Por importar 1')).toHaveFocus();
    expect(tab('Escalas 7')).toBeDisabled();
    // Past the last it wraps to the first, and back again.
    await user.keyboard('{ArrowRight}');
    expect(tab('Llegadas 4')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Por importar 1')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Llegadas 4')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Por importar 1')).toHaveFocus();
    expect(tab('Por importar 1')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('toImport');
    expect(within(tablist).getAllByRole('tab').map(item => item.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0']);
    expect(onChange.mock.calls.map(([id]) => id)).toEqual(['departures', 'toImport', 'arrivals', 'toImport', 'arrivals', 'toImport']);
    // Tab leaves the list from the chosen tab.
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});
