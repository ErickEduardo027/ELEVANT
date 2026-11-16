import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/features/auth/AuthContext';
import { AUTH_STORAGE_KEY, clearSession, persistSession, readSession } from '../src/features/auth/authService';
import { ProtectedRole } from './auth-boundary';

const account = { accountId: '11111111-1111-4111-8111-111111111111', token: 'SYNTHETIC_SESSION_TOKEN', role: 'ADMIN_OCC', roleLabel: 'OCC', name: 'QA operator', email: 'qa@example.test', expiresAt: '2099-01-01T00:00:00.000Z' };
afterEach(() => { vi.restoreAllMocks(); clearSession(); });

async function openProtectedPage(remember) {
  persistSession(account, remember);
  const replace = vi.spyOn(globalThis.__nextRouterMock, 'replace').mockImplementation(() => {});
  render(<AuthProvider><ProtectedRole role="ADMIN_OCC">{({ onLogout }) => <>
    <input aria-label="Filtro" defaultValue="QA-101" /><p>Ruta protegida</p>
    <button onClick={onLogout}>Salir del área</button>
  </>}</ProtectedRole></AuthProvider>);
  act(() => window.dispatchEvent(new Event('storage')));
  await screen.findByRole('button', { name: 'Salir del área' });
  replace.mockClear();
  return replace;
}

it.each([true, false])('cancels without clearing the actual %s session, then confirms and redirects', async remember => {
  const replace = await openProtectedPage(remember); const user = userEvent.setup();
  const store = remember ? window.localStorage : window.sessionStorage;
  await user.click(screen.getByRole('button', { name: 'Salir del área' }));
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(store.getItem(AUTH_STORAGE_KEY)).not.toBeNull();
  expect(readSession()?.accountId).toBe(account.accountId);
  expect(screen.getByLabelText('Filtro')).toHaveValue('QA-101');
  expect(replace).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Salir del área' }));
  await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(readSession()).toBeNull();
  expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
});

it('reports an actual storage removal failure without publishing logout or redirecting', async () => {
  const replace = await openProtectedPage(true); const user = userEvent.setup();
  const originalRemove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
    if (key === AUTH_STORAGE_KEY) throw new Error('Storage is unavailable');
    return originalRemove.call(this, key);
  });
  await user.click(screen.getByRole('button', { name: 'Salir del área' }));
  await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible cerrar sesión');
  expect(screen.getByText('Ruta protegida')).toBeInTheDocument();
  expect(readSession()?.accountId).toBe(account.accountId);
  expect(replace).not.toHaveBeenCalled();
});
