import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests } from '../../i18n/languageStore';
import LogoutConfirmation from './LogoutConfirmation';
import { useLogoutConfirmation } from './useLogoutConfirmation';

const session = { accountId: 'qa-account', email: 'qa@example.test', token: 'isolated-test-token' };

function Harness({ account = session, logout = async () => {} }) {
  const confirmation = useLogoutConfirmation(account, logout);
  return <>
    <input aria-label="Borrador" defaultValue="Trabajo sin guardar" />
    <button onClick={confirmation.request}>Solicitar salida</button>
    <LogoutConfirmation {...confirmation} />
  </>;
}

afterEach(() => { act(() => resetLanguageForTests('es')); });

describe('manual sign-out confirmation', () => {
  it('does not log out before confirmation; Cancel preserves the draft and returns focus', async () => {
    const logout = vi.fn(); const user = userEvent.setup();
    render(<Harness logout={logout} />);
    const trigger = screen.getByRole('button', { name: 'Solicitar salida' });
    await user.click(trigger);
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription('¿Estás seguro de que deseas cerrar sesión?');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    expect(logout).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Borrador')).toHaveValue('Trabajo sin guardar');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(logout).not.toHaveBeenCalled();
  });

  it('Escape closes only the confirmation and keeps the active session', async () => {
    const logout = vi.fn(); const user = userEvent.setup(); const underlyingEscape = vi.fn();
    window.addEventListener('keydown', underlyingEscape);
    try {
      render(<Harness logout={logout} />);
      await user.click(screen.getByRole('button', { name: 'Solicitar salida' }));
      underlyingEscape.mockClear();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(logout).not.toHaveBeenCalled();
      expect(underlyingEscape).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', underlyingEscape); }
  });

  it('makes one call for rapid confirmations and blocks dismissal while pending', async () => {
    let complete; const pending = new Promise(resolve => { complete = resolve; });
    const logout = vi.fn(() => pending); const user = userEvent.setup();
    render(<Harness logout={logout} />);
    await user.click(screen.getByRole('button', { name: 'Solicitar salida' }));
    const confirm = screen.getByRole('button', { name: 'Cerrar sesión' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true');
    await act(async () => complete());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog and draft on failure and allows a successful retry', async () => {
    const logout = vi.fn().mockRejectedValueOnce(new Error('Internal storage details')).mockResolvedValueOnce(undefined);
    const user = userEvent.setup(); render(<Harness logout={logout} />);
    await user.click(screen.getByRole('button', { name: 'Solicitar salida' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible cerrar sesión. Inténtalo de nuevo.');
    expect(screen.queryByText('Internal storage details')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Borrador')).toHaveValue('Trabajo sin guardar');
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(logout).toHaveBeenCalledTimes(2);
  });

  it('uses the global language preference without changing document language', async () => {
    act(() => resetLanguageForTests('en'));
    const originalLanguage = document.documentElement.lang; const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Solicitar salida' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm sign out' })).toHaveAttribute('lang', 'en');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.documentElement.lang).toBe(originalLanguage);
  });

  it('does not reopen a stale confirmation after switching accounts or expiring', async () => {
    const user = userEvent.setup(); const logout = vi.fn();
    const { rerender } = render(<Harness logout={logout} />);
    await user.click(screen.getByRole('button', { name: 'Solicitar salida' }));
    rerender(<Harness account={{ ...session, accountId: 'other', token: 'other' }} logout={logout} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    rerender(<Harness logout={logout} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Solicitar salida' }));
    rerender(<Harness account={null} logout={logout} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();
  });
});
