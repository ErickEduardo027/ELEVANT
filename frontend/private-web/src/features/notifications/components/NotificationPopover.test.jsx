import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import NotificationPopover from './NotificationPopover';

function center(overrides = {}) {
  return {
    count: 1,
    status: 'success',
    items: [{
      id: 'NOT-1', title: 'Nuevo contrato disponible',
      description: 'CTR-2026-001 está listo para OCC.', source: 'Contratos',
      createdAt: '2026-08-14T16:00:00-04:00', read: false,
    }],
    refresh: vi.fn(), markAsRead: vi.fn().mockResolvedValue({}),
    markAllAsRead: vi.fn().mockResolvedValue([]), ...overrides,
  };
}

describe('NotificationPopover', () => {
  it('muestra avisos reales y permite marcarlos como leídos', async () => {
    const notificationCenter = center();
    render(<NotificationPopover center={notificationCenter} onClose={vi.fn()} />);
    expect(screen.getByText('Nuevo contrato disponible')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Nuevo contrato disponible'));
    expect(notificationCenter.markAsRead).toHaveBeenCalledWith('NOT-1');
  });

  it('permite marcar todos los avisos', async () => {
    const notificationCenter = center();
    render(<NotificationPopover center={notificationCenter} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Leer todas' }));
    expect(notificationCenter.markAllAsRead).toHaveBeenCalledTimes(1);
  });
});
