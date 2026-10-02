import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from './LoginPage.jsx';
import { ThemeProvider } from '../shell/useTheme.jsx';
import { LanguageProvider } from '../shell/useLanguage.jsx';

function renderLogin(props = {}) {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <LoginPage {...props} />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('renders the Spanish copy by default', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Bienvenido a ELEVANT' })).toBeInTheDocument();
    expect(screen.getByText('Gestiona tus operaciones desde un solo lugar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('switches every string to English from the language control', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Inglés' }));

    expect(screen.getByRole('heading', { name: 'Welcome to ELEVANT' })).toBeInTheDocument();
    expect(screen.getByText('Manage your operations from one place.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText('Authorized personnel only.')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('marks the active option of each segmented control', async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(screen.getByRole('button', { name: 'Español' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Modo claro' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Modo oscuro' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: 'Modo oscuro' }));

    expect(screen.getByRole('button', { name: 'Modo oscuro' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Modo claro' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('submits the typed credentials and the remember flag', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderLogin({ onSubmit });

    await user.type(screen.getByLabelText('Correo electrónico'), 'ops@elevant.test');
    await user.type(screen.getByLabelText('Contraseña'), 'Elevant2026!');
    await user.click(screen.getByLabelText('Recordar sesión'));
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ops@elevant.test',
      password: 'Elevant2026!',
      remember: true,
    });
  });

  it('shows a rejected sign-in as an alert', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Credenciales inválidas.'));
    renderLogin({ onSubmit });

    await user.type(screen.getByLabelText('Correo electrónico'), 'ops@elevant.test');
    await user.type(screen.getByLabelText('Contraseña'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Credenciales inválidas.'));
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderLogin();

    const password = screen.getByLabelText('Contraseña');
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(password).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('switches the theme and the isotype variant from the top controls', async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(screen.getAllByAltText('ELEVANT')[0]).toHaveAttribute('src', expect.stringContaining('elevant-isotipo-light.png'));

    await user.click(screen.getByRole('button', { name: 'Modo oscuro' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getAllByAltText('ELEVANT')[0]).toHaveAttribute('src', expect.stringContaining('elevant-isotipo-dark.png'));
  });

  describe('validation', () => {
    it('blocks submit and reports both empty fields', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderLogin({ onSubmit });

      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText('Introduce tu correo electrónico.')).toBeInTheDocument();
      expect(screen.getByText('Introduce tu contraseña.')).toBeInTheDocument();
      expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
    });

    it('rejects a malformed email', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderLogin({ onSubmit });

      await user.type(screen.getByLabelText('Correo electrónico'), 'no-es-un-correo');
      await user.type(screen.getByLabelText('Contraseña'), 'Elevant2026!');
      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText('Introduce un correo electrónico válido.')).toBeInTheDocument();
    });

    it('clears a field error as soon as the user types in it', async () => {
      const user = userEvent.setup();
      renderLogin({ onSubmit: vi.fn() });

      await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
      expect(screen.getByText('Introduce tu correo electrónico.')).toBeInTheDocument();

      await user.type(screen.getByLabelText('Correo electrónico'), 'o');

      expect(screen.queryByText('Introduce tu correo electrónico.')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Correo electrónico')).not.toHaveAttribute('aria-invalid');
      expect(screen.getByText('Introduce tu contraseña.')).toBeInTheDocument();
    });

    it('reports validation errors in the active language', async () => {
      const user = userEvent.setup();
      renderLogin({ onSubmit: vi.fn() });

      await user.click(screen.getByRole('button', { name: 'Inglés' }));
      await user.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(screen.getByText('Enter your email.')).toBeInTheDocument();
      expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    });
  });
});
