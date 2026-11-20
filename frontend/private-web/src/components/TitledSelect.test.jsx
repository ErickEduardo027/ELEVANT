import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import TitledSelect from './TitledSelect';

afterEach(cleanup);

const STANDS = [
  { value: '', label: 'Sin posición (asignar después)' },
  { value: 's-a1', label: 'A1 · Terminal A · Cubren Riley Ramp, Ida Pérez y 1 más (1 elegible)' },
  { value: 's-b20', label: 'B20 · Terminal B · Nadie la cubre a esa hora', disabled: true },
];

it('lists its options and repeats the one it shows in its title (N37)', () => {
  // Read during the event: a controlled select goes back to its value once the handler returns.
  const onChange = vi.fn(event => event.target.value);
  const { rerender } = render(<label>Posición
    <TitledSelect value="" options={STANDS} onChange={onChange} className="mt-1" /></label>);
  const select = screen.getByRole('combobox', { name: 'Posición' });
  expect(screen.getAllByRole('option').map(option => [option.value, option.textContent, option.disabled])).toEqual([
    ['', 'Sin posición (asignar después)', false],
    ['s-a1', 'A1 · Terminal A · Cubren Riley Ramp, Ida Pérez y 1 más (1 elegible)', false],
    ['s-b20', 'B20 · Terminal B · Nadie la cubre a esa hora', true],
  ]);
  expect(select).toHaveAttribute('title', 'Sin posición (asignar después)');
  // Every other attribute is the select's own.
  expect(select).toHaveClass('mt-1');

  fireEvent.change(select, { target: { value: 's-a1' } });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.results[0].value).toBe('s-a1');
  rerender(<label>Posición<TitledSelect value="s-a1" options={STANDS} onChange={onChange} className="mt-1" /></label>);
  expect(select).toHaveAttribute('title', 'A1 · Terminal A · Cubren Riley Ramp, Ida Pérez y 1 más (1 elegible)');
});

it('names the option the browser shows when its value matches none (N37)', () => {
  // React then shows the first option that can be chosen.
  render(<TitledSelect aria-label="Tipo de avión" value="gone" onChange={() => {}}
    options={[{ value: 'x', label: 'Retirado', disabled: true }, { value: 'a320', label: 'A320 · Airbus A320' }]} />);
  const select = screen.getByRole('combobox', { name: 'Tipo de avión' });
  expect(select).toHaveValue('a320');
  expect(select).toHaveAttribute('title', 'A320 · Airbus A320');
});

it('has no title without an option to show (N37)', () => {
  render(<TitledSelect aria-label="Aerolínea" value="" onChange={() => {}} options={[]} />);
  expect(screen.getByRole('combobox', { name: 'Aerolínea' })).not.toHaveAttribute('title');
});
