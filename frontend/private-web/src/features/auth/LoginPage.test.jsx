import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

describe('LoginPage', () => {
  it('keeps the credential and remember-me contract while showing request states', async () => {
    const user = userEvent.setup();
    let rejectLogin;
    const onSubmit = vi.fn(() => new Promise((_, reject) => { rejectLogin = reject; }));
    render(<LoginPage onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Correo corporativo'), 'persona@empresa.com');
    await user.type(screen.getByLabelText('Contraseña'), 'temporary-password');
    await user.click(screen.getByLabelText('Recordarme'));
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'persona@empresa.com',
      password: 'temporary-password',
      remember: true,
    });
    expect(screen.getByRole('button', { name: 'Autenticando…' })).toBeDisabled();
    expect(screen.getByLabelText('Correo corporativo')).toBeDisabled();

    rejectLogin(new Error('Credenciales inválidas.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled());
    expect(screen.getByLabelText('Correo corporativo')).toHaveAttribute('aria-invalid', 'true');
  });

  it('retains password visibility and presents an honest recovery state', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const password = screen.getByLabelText('Contraseña');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(password).toHaveAttribute('type', 'password');

    expect(screen.getByText(/La recuperación en línea aún no está disponible/)).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: '¿Olvidaste tu contraseña?' }));
    expect(screen.getByText(/La recuperación en línea aún no está disponible/)).toBeVisible();
  });
});
