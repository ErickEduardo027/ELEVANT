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

  it('explains the scope requirement and hides unimplemented import/export', () => {
    render(<PlanningHeader onRefresh={() => {}} />);

    expect(screen.getByRole('button', { name: 'Nuevo vuelo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nuevo vuelo' })).toHaveAttribute('title', 'Seleccione una estación y espere a que termine la carga para crear un vuelo.');
    expect(screen.queryByRole('button', { name: 'Importar vuelos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar' })).not.toBeInTheDocument();
  });
});
