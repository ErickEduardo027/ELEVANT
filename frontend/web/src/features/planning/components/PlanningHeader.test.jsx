import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningHeader from './PlanningHeader';

describe('PlanningHeader', () => {
  it('renders the breadcrumb, title, and description', () => {
    render(<PlanningHeader onRefresh={() => {}} />);
    expect(screen.getByText('Dashboard / Planificación Operativa')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(
      screen.getByText('Gestione la planificación operacional de vuelos, recursos y posiciones.')
    ).toBeInTheDocument();
  });

  it('calls onRefresh when Actualizar is clicked', async () => {
    const onRefresh = vi.fn();
    render(<PlanningHeader onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('enables new flight and keeps future actions disabled', () => {
    render(<PlanningHeader onRefresh={() => {}} />);
    expect(screen.getByRole('button', { name: 'Nuevo vuelo' })).toBeEnabled();
    for (const label of ['Importar vuelos', 'Exportar']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Próximamente');
    }
  });
});
