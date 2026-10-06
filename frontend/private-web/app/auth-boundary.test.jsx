import { act, render, screen, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ readSession: vi.fn() }));

vi.mock('../src/features/auth/authService', () => ({
  AUTH_EXPIRED_EVENT: 'elevant-auth-expired',
  changePassword: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  readSession: auth.readSession,
  PasswordChangeRequiredError: class PasswordChangeRequiredError extends Error {},
}));

vi.mock('../src/features/auth/LoginPage', () => ({
  default: () => <main className="elv-shell">Formulario de acceso</main>,
}));

import { AuthProvider } from '../src/features/auth/AuthContext';
import { LoginRoute } from './auth-boundary';

it('hydrates LoginRoute through its session fallback before rendering the login shell', async () => {
  auth.readSession.mockReturnValue(null);
  const app = <AuthProvider><LoginRoute /></AuthProvider>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.querySelector('[role="status"]')).toHaveTextContent('Comprobando sesión…');

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  let root;
  await act(async () => {
    root = hydrateRoot(container, app);
  });

  expect(container.querySelector('[role="status"]')).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('main')).toHaveClass('elv-shell'));
  expect(container.querySelector('main')).toHaveClass('elv-shell');
  expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydration failed|did not match/i);

  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

it('shows the session fallback when LoginRoute mounts under an already-ready provider', async () => {
  auth.readSession.mockReturnValue(null);
  const view = render(<AuthProvider><p>Inicio</p></AuthProvider>);

  view.rerender(<AuthProvider><LoginRoute /></AuthProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Comprobando sesión…');
  expect(await screen.findByText('Formulario de acceso')).toBeInTheDocument();
  view.unmount();
});
