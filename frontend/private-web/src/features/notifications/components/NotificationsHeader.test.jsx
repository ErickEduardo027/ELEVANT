import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationsHeader from './NotificationsHeader';

const COUNTS = { total: 12, unread: 5, critical: 1, needsAttention: 3 };

describe('NotificationsHeader', () => {
  it('renders the title, subtitle and counts strip', () => {
    render(<NotificationsHeader counts={COUNTS} onMarkAllAsRead={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Notificaciones' })).toBeInTheDocument();
    expect(screen.getByText('Historial y alertas operativas del sistema.')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('disables "Marcar todas como leídas" when there are no unread notifications', () => {
    render(
      <NotificationsHeader counts={{ ...COUNTS, unread: 0 }} onMarkAllAsRead={() => {}} onOpenSettings={() => {}} />
    );
    expect(screen.getByRole('button', { name: /marcar todas como leídas/i })).toBeDisabled();
  });

  it('calls onMarkAllAsRead when clicked', async () => {
    const onMarkAllAsRead = vi.fn();
    render(<NotificationsHeader counts={COUNTS} onMarkAllAsRead={onMarkAllAsRead} onOpenSettings={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /marcar todas como leídas/i }));
    expect(onMarkAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings when the settings button is clicked', async () => {
    const onOpenSettings = vi.fn();
    render(<NotificationsHeader counts={COUNTS} onMarkAllAsRead={() => {}} onOpenSettings={onOpenSettings} />);

    await userEvent.click(screen.getByRole('button', { name: /preferencias de notificaciones/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});