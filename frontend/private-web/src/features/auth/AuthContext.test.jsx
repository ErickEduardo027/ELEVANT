import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ readSession: vi.fn(), logout: vi.fn() }));
vi.mock('./authService', () => ({
  AUTH_EXPIRED_EVENT: 'elevant-auth-expired',
  changePassword: vi.fn(),
  login: vi.fn(),
  logout: auth.logout,
  readSession: auth.readSession,
}));

import { AuthProvider, useAuth } from './AuthContext';

function SessionGate() {
  const { ready, session } = useAuth();
  return ready
    ? <p>{session ? `private:${session.role}` : 'public'}</p>
    : <p role="status">Comprobando sesión…</p>;
}

it('keeps the server fallback for the first client render, then restores a persisted session', async () => {
  auth.readSession.mockReturnValue({ role: 'ADMIN_OCC' });
  const app = <AuthProvider><SessionGate /></AuthProvider>;
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container).toHaveTextContent('Comprobando sesión…');

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  let root;
  await act(async () => {
    root = hydrateRoot(container, app);
  });

  expect(container).toHaveTextContent('private:ADMIN_OCC');
  expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydration failed|did not match/i);

  await act(async () => root.unmount());
  container.remove();
  consoleError.mockRestore();
});

function AccountControls() {
  const { session, logout } = useAuth();
  return <><p>{session?.email ?? 'public'}</p><button onClick={() => { void logout(); }}>Exit</button></>;
}

it('preserves the new account when an earlier sign-out finishes after a storage change', async () => {
  auth.readSession.mockReturnValue({ accountId: 'first', email: 'first@example.test', token: 'first-token' });
  let complete;
  auth.logout.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  render(<AuthProvider><AccountControls /></AuthProvider>);
  act(() => window.dispatchEvent(new StorageEvent('storage')));
  await screen.findByText('first@example.test');
  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  expect(auth.logout).toHaveBeenCalledTimes(1);
  auth.readSession.mockReturnValue({ accountId: 'second', email: 'second@example.test', token: 'second-token' });
  act(() => window.dispatchEvent(new StorageEvent('storage')));
  await act(async () => complete());
  await waitFor(() => expect(screen.getByText('second@example.test')).toBeInTheDocument());
  expect(screen.queryByText('public')).not.toBeInTheDocument();
});
