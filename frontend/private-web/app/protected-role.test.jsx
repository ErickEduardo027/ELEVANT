import { act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ readSession: vi.fn() }));

vi.mock('../src/features/auth/authService', () => ({
  AUTH_EXPIRED_EVENT: 'elevant-auth-expired',
  changePassword: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  readSession: auth.readSession,
}));

import { AuthProvider } from '../src/features/auth/AuthContext';
import { ProtectedRole } from './auth-boundary';

let replaceSpy;
afterEach(() => replaceSpy?.mockRestore());

it('restores the saved role after hydration and redirects a mismatched protected route', async () => {
  auth.readSession.mockReturnValue({ role: 'FINANZAS', roleLabel: 'Finanzas', name: 'Usuario' });
  replaceSpy = vi.spyOn(globalThis.__nextRouterMock, 'replace').mockImplementation(() => {});
  const app = (
    <AuthProvider>
      <ProtectedRole role="ADMIN_OCC">{() => <p>Contenido OCC</p>}</ProtectedRole>
    </AuthProvider>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.querySelector('[role="status"]')).toHaveTextContent('Comprobando sesión…');

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  let root;
  await act(async () => {
    root = hydrateRoot(container, app);
  });

  expect(replaceSpy).toHaveBeenCalledWith('/finanzas');
  expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydration failed|did not match/i);

  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
});
