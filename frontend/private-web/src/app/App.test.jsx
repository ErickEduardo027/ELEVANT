import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { clearSession, handleUnauthorizedResponse } from '../features/auth/authService';
import { ThemeProvider } from '../features/shell/useTheme.jsx';
import { LanguageProvider } from '../features/shell/useLanguage.jsx';

// App is the root of the legacy multi-page entries (dashboard/contracts/finance
// -main.jsx), which mount these providers around it. LoginPage reads both.
function renderApp() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

vi.mock('../features/shell/AppShell.jsx', () => ({
  default: ({ onLogout }) => (
    <div>
      <h1>Admin OCC shell</h1>
      <button type="button" onClick={onLogout}>
        logout-admin
      </button>
    </div>
  ),
}));

vi.mock('../features/contracts/shell/ContractsShell.jsx', () => ({
  default: ({ onLogout }) => (
    <div>
      <h1>Contratos shell</h1>
      <button type="button" onClick={onLogout}>
        logout-contracts
      </button>
    </div>
  ),
}));

vi.mock('../features/finance/shell/FinanceShell.jsx', () => ({
  default: ({ onLogout }) => (
    <div>
      <h1>Finanzas shell</h1>
      <button type="button" onClick={onLogout}>
        logout-finance
      </button>
    </div>
  ),
}));

vi.mock('../features/human-resources/HumanResourcesShell.jsx', () => ({
  default: ({ onLogout }) => (
    <div>
      <h1>Gestión Humana shell</h1>
      <button type="button" onClick={onLogout}>
        logout-hr
      </button>
    </div>
  ),
}));

beforeEach(() => {
  clearSession();
  window.history.replaceState({}, '', '/login');
});

afterEach(() => {
  clearSession();
});

describe('App routing', () => {
  it(
    'logs in the admin user and lands on Admin/OCC',
    async () => {
      renderApp();
      expect(screen.getByRole('checkbox', { name: /recordar sesión/i })).not.toBeChecked();
      await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'admin@elevant.test');
      await userEvent.type(screen.getByLabelText(/^contraseña$/i, { selector: 'input' }), 'Elevant2026!');
      await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

      expect(await screen.findByText('Admin OCC shell')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/admin-occ');
      expect(window.localStorage.getItem('elevant-auth-session')).toBeNull();
      expect(window.sessionStorage.getItem('elevant-auth-session')).not.toBeNull();
    },
    15000
  );

  it.each([
    {
      email: 'admin@elevant.test',
      shell: 'Admin OCC shell',
      logoutButton: 'logout-admin',
      path: '/admin-occ',
    },
    {
      email: 'gestionhumana@elevant.test',
      shell: 'Gestión Humana shell',
      logoutButton: 'logout-hr',
      path: '/gestion-humana',
    },
    {
      email: 'contratos@elevant.test',
      shell: 'Contratos shell',
      logoutButton: 'logout-contracts',
      path: '/contratos',
    },
    {
      email: 'finanzas@elevant.test',
      shell: 'Finanzas shell',
      logoutButton: 'logout-finance',
      path: '/finanzas',
    },
  ])(
    'logs out from $path back to /login',
    async ({ email, shell, logoutButton, path }) => {
      renderApp();
      await userEvent.type(screen.getByLabelText(/correo electrónico/i), email);
      await userEvent.type(screen.getByLabelText(/^contraseña$/i, { selector: 'input' }), 'Elevant2026!');
      await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

      expect(await screen.findByText(shell)).toBeInTheDocument();
      expect(window.location.pathname).toBe(path);

      await userEvent.click(await screen.findByRole('button', { name: logoutButton }));
      await waitFor(() => expect(window.location.pathname).toBe('/login'));
      expect(await screen.findByText(/gestiona tus operaciones desde un solo lugar/i)).toBeInTheDocument();
    },
    15000
  );

  it(
    'blocks access to another role and redirects to the authenticated home',
    async () => {
      window.sessionStorage.setItem(
        'elevant-auth-session',
        JSON.stringify({
          token: 'test-session-token',
          expiresAt: '2099-01-01T00:00:00.000Z',
          email: 'gestionhumana@elevant.test',
          name: 'Camila Reyes',
          role: 'GESTION_HUMANA',
          roleLabel: 'Gestión Humana',
          homePath: '/gestion-humana',
        })
      );
      window.history.replaceState({}, '', '/admin-occ');

      renderApp();

      expect(await screen.findByText('Gestión Humana shell')).toBeInTheDocument();
      await waitFor(() => expect(window.location.pathname).toBe('/gestion-humana'));
    },
    15000
  );

  it('clears the active App session and redirects when the API reports 401', async () => {
    renderApp();
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'admin@elevant.test');
    await userEvent.type(screen.getByLabelText(/^contraseña$/i, { selector: 'input' }), 'Elevant2026!');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
    expect(await screen.findByText('Admin OCC shell')).toBeInTheDocument();

    act(() => {
      expect(handleUnauthorizedResponse({ status: 401 })).toBe(true);
    });

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(await screen.findByText(/gestiona tus operaciones desde un solo lugar/i)).toBeInTheDocument();
  });
});
