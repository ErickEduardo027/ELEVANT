import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewSwitcher, { PLANNING_VIEWS } from './ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders the four real views in order, as a group of toggles', () => {
    render(<ViewSwitcher active="timeline" onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Vistas de planificación' });
    expect([...group.querySelectorAll('button')].map(button => button.textContent))
      .toEqual(['Línea de tiempo', 'Posiciones', 'Tabla', 'Mapa']);
    expect(PLANNING_VIEWS).toEqual(['timeline', 'positions', 'table', 'map']);
    expect(screen.queryByRole('button', { name: 'Calendario' })).not.toBeInTheDocument();
  });

  it('marks the active view as selected', () => {
    render(<ViewSwitcher active="table" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Tabla' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Línea de tiempo' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked view id', async () => {
    const onChange = vi.fn();
    render(<ViewSwitcher active="timeline" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Posiciones' }));
    expect(onChange).toHaveBeenCalledWith('positions');
  });
});
