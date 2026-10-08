import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Combobox, { OTHER_OPTION } from './Combobox';

const options = [
  { value: 'RAMP-AC', label: 'Aire acondicionado', hint: 'RAMP-AC' },
  { value: 'RAMP-TOW', label: 'Remolque de aeronaves', hint: 'RAMP-TOW' },
  { value: 'RAMP-STAIRS', label: 'Escaleras móviles', hint: 'RAMP-STAIRS' },
];

function Harness({ onChange = () => {}, ...props }) {
  const [value, setValue] = useState('');
  return <Combobox id="service" label="Servicio" value={value} options={options}
    onChange={next => { setValue(next); onChange(next); }} hint="Elige uno." {...props} />;
}

it('filters by label or code ignoring accents and always offers «Otro»', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const input = screen.getByRole('combobox', { name: 'Servicio' });
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(input).toHaveAccessibleDescription('Elige uno.');

  await user.type(input, 'movil');
  expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByRole('option').map(option => option.textContent))
    .toEqual(['Escaleras móvilesRAMP-STAIRS', 'Otro']);

  await user.clear(input);
  await user.type(input, 'tow');
  expect(screen.getAllByRole('option').map(option => option.textContent))
    .toEqual(['Remolque de aeronavesRAMP-TOW', 'Otro']);

  await user.clear(input);
  await user.type(input, 'zzz');
  expect(screen.getByText(/Sin coincidencias/)).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Otro' })).toBeInTheDocument();
});

it('navigates with the keyboard and selects with Enter', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const input = screen.getByRole('combobox', { name: 'Servicio' });
  input.focus();

  await user.keyboard('{ArrowDown}');
  expect(input).toHaveAttribute('aria-activedescendant', 'service-option-0');
  await user.keyboard('{ArrowDown}');
  expect(input).toHaveAttribute('aria-activedescendant', 'service-option-1');
  await user.keyboard('{End}');
  expect(input).toHaveAttribute('aria-activedescendant', 'service-option-3');
  await user.keyboard('{Home}{Enter}');

  expect(onChange).toHaveBeenCalledWith('RAMP-AC');
  expect(input).toHaveValue('Aire acondicionado');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('selects options and «Otro» with the mouse', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await user.click(screen.getByRole('combobox', { name: 'Servicio' }));
  await user.click(screen.getByRole('option', { name: /Remolque/ }));
  expect(onChange).toHaveBeenCalledWith('RAMP-TOW');
  expect(screen.getByRole('combobox', { name: 'Servicio' })).toHaveValue('Remolque de aeronaves');

  await user.click(screen.getByRole('combobox', { name: 'Servicio' }));
  expect(screen.getByRole('option', { name: /Remolque/ })).toHaveAttribute('aria-selected', 'true');
  await user.click(screen.getByRole('option', { name: 'Otro' }));
  expect(onChange).toHaveBeenCalledWith(OTHER_OPTION);
  expect(screen.getByRole('combobox', { name: 'Servicio' })).toHaveValue('Otro');
});

it('closes with Escape without propagating and restores the selected label on blur', async () => {
  const user = userEvent.setup();
  const windowEscape = vi.fn();
  const listener = event => { if (event.key === 'Escape') windowEscape(); };
  window.addEventListener('keydown', listener);
  render(<><Harness /><button type="button">Fuera</button></>);
  const input = screen.getByRole('combobox', { name: 'Servicio' });

  await user.type(input, 'aire');
  await user.keyboard('{Escape}');
  expect(input).toHaveAttribute('aria-expanded', 'false');
  expect(input).toHaveValue('');
  expect(windowEscape).not.toHaveBeenCalled();

  await user.type(input, 'texto libre');
  await user.click(screen.getByRole('button', { name: 'Fuera' }));
  expect(input).toHaveValue('');
  window.removeEventListener('keydown', listener);
});

it('marks the field invalid and describes the error', () => {
  render(<Harness error="Selecciona un servicio." />);
  const input = screen.getByRole('combobox', { name: 'Servicio' });
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Selecciona un servicio.');
});
