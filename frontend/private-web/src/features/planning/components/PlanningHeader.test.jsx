import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningHeader from './PlanningHeader';

describe('PlanningHeader', () => {
  it('describes the read-only operational planning surface', () => {
    render(<PlanningHeader onRefresh={() => {}} />);

    expect(screen.getByText('Dashboard / Planificación Operativa')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Planificación Operativa' })).toBeInTheDocument();
    expect(
      screen.getByText('Consulte las escalas, sus tramos y los recursos operativos autorizados para cada estación.')
    ).toBeInTheDocument();
  });

  it('keeps refresh available', async () => {
    const onRefresh = vi.fn();
    render(<PlanningHeader onRefresh={onRefresh} />);

    const button = screen.getByRole('button', { name: 'Actualizar' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('explains why creating or importing is unavailable and offers no export placeholder (3-N28)', () => {
    render(<PlanningHeader onRefresh={() => {}} />);

    for (const label of ['Nuevo vuelo', 'Importar vuelos']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Elija una estación y una fecha de su alcance para planificar.');
    }
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Próximamente')).not.toBeInTheDocument();
  });

  it('enables creating and importing for a station and date in scope', async () => {
    const onCreate = vi.fn();
    render(<PlanningHeader onRefresh={() => {}} onCreate={onCreate} canCreate canImport onImport={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo vuelo' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Importar vuelos' })).toBeEnabled();
  });
});