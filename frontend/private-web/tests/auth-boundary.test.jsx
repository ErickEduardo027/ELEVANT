import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRouter = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => window.location.pathname,
}));

import { LoginRoute, ProtectedRole } from '../app/auth-boundary';
import { AuthProvider } from '../src/features/auth/AuthContext';

describe('Next.js authentication boundary', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockRouter.replace.mockReset();
    mockRouter.push.mockReset();
  });

  it('keeps protected content behind the session readiness/role guard', async () => {
    render(
      <AuthProvider>
        <ProtectedRole role="ADMIN_OCC">{() => <p>Protected OCC content</p>}</ProtectedRole>
      </AuthProvider>,
    );

    expect(screen.queryByText('Protected OCC content')).not.toBeInTheDocument();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/login'));
  });

  it('preserves the test login storage choice and redirects using the session home path', async () => {
    render(<AuthProvider><LoginRoute /></AuthProvider>);

    const emailInput = await screen.findByLabelText(/correo electrónico/i);
    const passwordInput = await screen.findByLabelText(/^contraseña$/i, { selector: 'input' });
    const submitButton = await screen.findByRole('button', { name: /iniciar sesión/i });

    fireEvent.change(emailInput, {
      target: { value: 'admin@elevant.test' },
    });
    fireEvent.change(passwordInput, {
      target: { value: 'Elevant2026!' },
    });
    fireEvent.click(submitButton);

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/admin-occ'));
    expect(window.sessionStorage.getItem('elevant-auth-session')).not.toBeNull();
    expect(window.localStorage.getItem('elevant-auth-session')).toBeNull();
  });
});
