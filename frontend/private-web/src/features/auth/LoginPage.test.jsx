import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';
import { resetAuthLanguageForTests } from './i18n/useAuthLanguage';

describe('LoginPage', () => {
  it('keeps the credential and remember-me contract while showing request states', async () => {
    const user = userEvent.setup();
    let rejectLogin;
    const onSubmit = vi.fn(() => new Promise((_, reject) => { rejectLogin = reject; }));
    render(<LoginPage onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Correo electrónico'), 'persona@empresa.com');
    await user.type(screen.getByLabelText('Contraseña'), 'temporary-password');
    await user.click(screen.getByLabelText('Recordar sesión'));
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'persona@empresa.com',
      password: 'temporary-password',
      remember: true,
    });
    expect(screen.getByRole('button', { name: 'Autenticando…' })).toBeDisabled();
    expect(screen.getByLabelText('Correo electrónico')).toBeDisabled();

    rejectLogin(new Error('Credenciales inválidas.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled());
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
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

describe('LoginPage validation, language and theme', () => {
  it('blocks invalid submissions with accessible field errors and keeps values on language change', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<LoginPage onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Ingresa tu correo electrónico.')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText('Correo electrónico'), 'persona@empresa.com');
    await user.click(screen.getByRole('button', { name: /Idioma/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /English/ }));

    expect(screen.getByRole('heading', { name: 'Welcome to ELEVANT' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveValue('persona@empresa.com');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    resetAuthLanguageForTests('es');
  });

  it('toggles the theme in both directions and ignores duplicate submits while busy', async () => {
    const user = userEvent.setup();
    let resolveLogin;
    const onSubmit = vi.fn(() => new Promise(resolve => { resolveLogin = resolve; }));
    render(<LoginPage onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Cambiar a tema oscuro' }));
    expect(document.documentElement).toHaveClass('dark');
    await user.click(screen.getByRole('button', { name: 'Cambiar a tema claro' }));
    expect(document.documentElement).not.toHaveClass('dark');

    await user.type(screen.getByLabelText('Correo electrónico'), 'persona@empresa.com');
    await user.type(screen.getByLabelText('Contraseña'), 'x');
    const submit = screen.getByRole('button', { name: 'Iniciar sesión' });
    await user.click(submit);
    await user.click(screen.getByRole('button', { name: 'Autenticando…' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolveLogin();
  });
});
