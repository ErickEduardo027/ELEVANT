import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { clearSession } from '../features/auth/authService';

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
  it('logs in the admin user and lands on Admin/OCC', async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText(/correo corporativo/i), 'admin@elevant.test');
    await userEvent.type(screen.getByLabelText(/^contraseña$/i, { selector: 'input' }), 'Elevant2026!');
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(await screen.findByText('Admin OCC shell')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin-occ');
  });

  it('blocks access to another role and redirects to the authenticated home', async () => {
    window.sessionStorage.setItem(
      'elevant-auth-session',
      JSON.stringify({
        email: 'gestionhumana@elevant.test',
        name: 'Camila Reyes',
        role: 'GESTION_HUMANA',
        roleLabel: 'Gestión Humana',
        homePath: '/gestion-humana',
      })
    );
    window.history.replaceState({}, '', '/admin-occ');

    render(<App />);

    expect(await screen.findByText('Gestión Humana shell')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/gestion-humana'));
  });

  it('logs out back to /login', async () => {
    window.sessionStorage.setItem(
      'elevant-auth-session',
      JSON.stringify({
        email: 'finanzas@elevant.test',
        name: 'Elena Rojas',
        role: 'FINANZAS',
        roleLabel: 'Finanzas',
        homePath: '/finanzas',
      })
    );
    window.history.replaceState({}, '', '/finanzas');

    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: 'logout-finance' }));

    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    expect(await screen.findByText(/inicia sesión para continuar/i)).toBeInTheDocument();
  });
});
