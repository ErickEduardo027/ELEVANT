import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsShell from './ContractsShell';

describe('ContractsShell', () => {
  it('opens the contracts home and preserves the existing shell design', async () => {
    render(<ContractsShell />);
    expect(await screen.findByRole('heading', { name: 'Resumen contractual' })).toBeInTheDocument();
    expect(screen.getByText(/Datos sintéticos · solo lectura/i)).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Inicio').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('Contratos')).toBeInTheDocument();
    expect(within(nav).getByText('Solicitudes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('opens a future module placeholder from the home action', async () => {
    render(<ContractsShell />);
    await waitFor(() => expect(screen.getByText('Contratos recientes')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /ver contratos/i }));
    expect(await screen.findByRole('heading', { name: 'Contratos' })).toBeInTheDocument();
  });
});
