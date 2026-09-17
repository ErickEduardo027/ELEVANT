import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';

describe('Human Resources dashboard-only demo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a permanent synthetic-data warning without navigation or mutation actions', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <MemoryRouter>
        <DashboardPage dashboardReadOnlyDemo />
      </MemoryRouter>,
    );

    expect(screen.getByRole('region', { name: /aviso de demostración/i })).toHaveTextContent(
      'Datos sintéticos · Solo lectura',
    );
    expect(screen.getByText(/no permite crear, editar, exportar ni guardar información/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.queryAllByTestId('kpi-skeleton')).toHaveLength(0));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /actualizar resumen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revisar cuentas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver habilitaciones/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revisar vencidos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver todos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /gestionar cuentas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ver$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver historial completo/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Accesos rápidos')).not.toBeInTheDocument();
  });

  it('keeps the synthetic-data warning visible in the error state and offers no retry action', async () => {
    render(
      <MemoryRouter>
        <DashboardPage dashboardReadOnlyDemo forceState="error" />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Datos sintéticos · Solo lectura')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No fue posible cargar el resumen.'));
    expect(screen.queryByRole('button', { name: /reintentar/i })).not.toBeInTheDocument();
  });

  it('retains the normal HR surface when the demo flag is absent', async () => {
    render(
      <MemoryRouter>
        <DashboardPage dashboardReadOnlyDemo={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Datos sintéticos · Solo lectura')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /revisar cuentas/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actualizar resumen/i })).toBeInTheDocument();
  });
});
