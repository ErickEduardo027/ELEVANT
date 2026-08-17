import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationsPage from './NotificationsPage';
import { __resetNotificationsStoreForTests } from '../../services/notificationsService';

function makeNotification(overrides) {
  return {
    id: 'NOT-1',
    category: 'operational',
    severity: 'warning',
    title: 'Vuelo DM161 fuera de tiempo estimado',
    description: 'El vuelo DM161 no llegó a la posición asignada según la hora estimada.',
    read: false,
    createdAt: new Date().toISOString(),
    flightNumber: 'DM161',
    airline: 'Arajet',
    position: 'A5',
    operationId: null,
    relatedModule: 'flight-monitoring',
    relatedRoute: 15,
    source: 'Monitoreo de vuelos',
    metadata: {},
    ...overrides,
  };
}

const NOTIFICATIONS = [
  makeNotification({ id: 'NOT-1' }),
  makeNotification({
    id: 'NOT-2',
    title: 'Nueva operación pendiente de revisión',
    description: 'requiere revisión',
    flightNumber: 'AA904',
    airline: 'American Airlines',
    relatedModule: 'approvals',
    relatedRoute: 'REV-1002',
    read: true,
  }),
];

function renderPage(props = {}) {
  return render(
    <NotificationsPage
      status="success"
      data={{ station: { code: 'PUJ' }, notifications: NOTIFICATIONS }}
      error={null}
      onRetry={() => {}}
      onMarkAsRead={vi.fn().mockResolvedValue({})}
      onMarkAsUnread={vi.fn().mockResolvedValue({})}
      onMarkManyAsRead={vi.fn().mockResolvedValue([])}
      onMarkManyAsUnread={vi.fn().mockResolvedValue([])}
      onMarkAllAsRead={vi.fn().mockResolvedValue([])}
      onNavigateToResource={() => {}}
      {...props}
    />
  );
}

afterEach(() => {
  __resetNotificationsStoreForTests();
});

describe('NotificationsPage', () => {
  it('renders the header and the feed by default', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Notificaciones' })).toBeInTheDocument();
    expect(screen.getByText('Vuelo DM161 fuera de tiempo estimado')).toBeInTheDocument();
    expect(screen.getByText('Nueva operación pendiente de revisión')).toBeInTheDocument();
  });

  it('shows the skeleton while loading', () => {
    renderPage({ status: 'loading' });
    expect(screen.getByTestId('notification-skeleton')).toBeInTheDocument();
  });

  it('shows the general empty state when there are no notifications', () => {
    renderPage({ forceState: 'notificationsEmpty' });
    expect(screen.getByText('Sin notificaciones nuevas')).toBeInTheDocument();
  });

  it('shows the filtered empty state when a filter matches nothing', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Categoría'), 'personal');
    expect(screen.getByText('No hay notificaciones en esta categoría.')).toBeInTheDocument();
  });

  it('clicking a card opens the detail drawer and marks it as read', async () => {
    const onMarkAsRead = vi.fn().mockResolvedValue({});
    renderPage({ onMarkAsRead });
    await userEvent.click(screen.getByText('Vuelo DM161 fuera de tiempo estimado'));

    expect(screen.getByTestId('notification-detail-drawer')).toBeInTheDocument();
    expect(onMarkAsRead).toHaveBeenCalledWith('NOT-1');
    expect(await screen.findByText('Notificación marcada como leída.')).toBeInTheDocument();
  });

  it('does not call onMarkAsRead again when opening an already-read notification', async () => {
    const onMarkAsRead = vi.fn().mockResolvedValue({});
    renderPage({ onMarkAsRead });
    await userEvent.click(screen.getByText('Nueva operación pendiente de revisión'));
    expect(onMarkAsRead).not.toHaveBeenCalled();
  });

  it('selecting two cards shows the bulk actions bar', async () => {
    renderPage();
    const checkboxes = screen.getAllByRole('checkbox', { name: 'Seleccionar notificación' });
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);

    expect(screen.getByText('2 seleccionadas')).toBeInTheDocument();
  });

  it('"Marcar todas como leídas" calls onMarkAllAsRead and shows a toast', async () => {
    const onMarkAllAsRead = vi.fn().mockResolvedValue([]);
    renderPage({ onMarkAllAsRead });
    await userEvent.click(screen.getByRole('button', { name: /marcar todas como leídas/i }));

    expect(onMarkAllAsRead).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Todas las notificaciones fueron marcadas como leídas.')).toBeInTheDocument();
  });

  it('clicking "Ver vuelo" in the drawer calls onNavigateToResource with the flight route', async () => {
    const onNavigateToResource = vi.fn();
    renderPage({ onNavigateToResource });
    await userEvent.click(screen.getByText('Vuelo DM161 fuera de tiempo estimado'));
    await userEvent.click(screen.getByRole('button', { name: /ver vuelo/i }));

    expect(onNavigateToResource).toHaveBeenCalledWith('flight-monitoring', 15);
  });

  it('shows the error panel and retries', async () => {
    const onRetry = vi.fn();
    renderPage({ status: 'error', error: new Error('network down'), onRetry });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
