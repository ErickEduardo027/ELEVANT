import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Topbar from './Topbar';

const STATION = {
  code: 'PUJ',
  localAbbr: 'AST',
  localTime: '2026-08-01T14:32:00-04:00',
  utcTime: '2026-08-01T18:32:00Z',
};

const USER = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

describe('Topbar', () => {
  it('renders the station code and both clocks with their labels', () => {
    render(<Topbar station={STATION} notificationsCount={3} theme="light" onToggleTheme={() => {}} user={USER} />);
    expect(screen.getByText('PUJ')).toBeInTheDocument();
    expect(screen.getByText(/AST/)).toBeInTheDocument();
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it('shows the notifications badge count only when greater than zero', () => {
    const { rerender } = render(
      <Topbar station={STATION} notificationsCount={3} theme="light" onToggleTheme={() => {}} user={USER} />
    );
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3');

    rerender(<Topbar station={STATION} notificationsCount={0} theme="light" onToggleTheme={() => {}} user={USER} />);
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  });

  it('caps the notifications badge at "99+" for large counts', () => {
    render(<Topbar station={STATION} notificationsCount={140} theme="light" onToggleTheme={() => {}} user={USER} />);
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('99+');
  });

  it('calls onOpenNotifications when the bell is clicked', async () => {
    const onOpenNotifications = vi.fn();
    render(
      <Topbar
        station={STATION}
        notificationsCount={3}
        theme="light"
        onToggleTheme={() => {}}
        user={USER}
        onOpenNotifications={onOpenNotifications}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleTheme when the theme button is clicked', async () => {
    const onToggleTheme = vi.fn();
    render(
      <Topbar station={STATION} notificationsCount={0} theme="light" onToggleTheme={onToggleTheme} user={USER} />
    );
    await userEvent.click(screen.getByRole('button', { name: /cambiar a modo oscuro/i }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('opens the user menu on avatar click and shows profile and logout options', async () => {
    render(<Topbar station={STATION} notificationsCount={0} theme="light" onToggleTheme={() => {}} user={USER} />);
    expect(screen.queryByText(/cerrar sesi/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /laisha/i }));
    expect(screen.getByText('Perfil')).toBeInTheDocument();
    expect(screen.getByText(/cerrar sesi/i)).toBeInTheDocument();
  });

  it('calls onLogout when the logout menu item is clicked', async () => {
    const onLogout = vi.fn();
    render(
      <Topbar
        station={STATION}
        notificationsCount={0}
        theme="light"
        onToggleTheme={() => {}}
        user={USER}
        onLogout={onLogout}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /laisha/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /cerrar sesi/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('does not render a menu button when onOpenMenu is not provided', () => {
    render(<Topbar station={STATION} notificationsCount={0} theme="light" onToggleTheme={() => {}} user={USER} />);
    expect(screen.queryByRole('button', { name: /abrir men/i })).not.toBeInTheDocument();
  });

  it('calls onOpenMenu when the mobile menu button is clicked', async () => {
    const onOpenMenu = vi.fn();
    render(
      <Topbar
        station={STATION}
        notificationsCount={0}
        theme="light"
        onToggleTheme={() => {}}
        user={USER}
        onOpenMenu={onOpenMenu}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /abrir men/i }));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });
});