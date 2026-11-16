import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNotifications } from '../../services/notificationsService';
import { loadOperationalNotifications } from '../../services/operationalCommunicationService';
import useNotificationBadge, { NOTIFICATIONS_REFRESH_EVENT } from './useNotificationBadge';

vi.mock('../../services/notificationsService', () => ({ getNotifications: vi.fn() }));
vi.mock('../../services/operationalCommunicationService', () => ({
  loadOperationalNotifications: vi.fn(),
  setOperationalNotificationRead: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useNotificationBadge', () => {
  it('cuenta solo las notificaciones no leídas', async () => {
    getNotifications.mockResolvedValue({ notifications: [{ read: false }, { read: true }, { read: false }] });
    const { result } = renderHook(() => useNotificationBadge({ intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(result.current.status).toBe('success');
  });

  it('se actualiza cuando otro módulo solicita refrescar la campana', async () => {
    getNotifications.mockResolvedValueOnce({ notifications: [] }).mockResolvedValueOnce({ notifications: [{ read: false }] });
    const { result } = renderHook(() => useNotificationBadge({ intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.status).toBe('success'));
    act(() => window.dispatchEvent(new CustomEvent(NOTIFICATIONS_REFRESH_EVENT)));
    await waitFor(() => expect(result.current.count).toBe(1));
  });

  it('uses persistent operational notifications for the OCC badge', async () => {
    loadOperationalNotifications.mockResolvedValue({
      notifications: [
        { id: 'first', readAt: null },
        { id: 'second', readAt: '2026-09-24T12:00:00Z' },
      ],
      hasMore: false,
    });

    const { result } = renderHook(() => useNotificationBadge({ source: 'operational', intervalMs: 60_000 }));

    await waitFor(() => expect(result.current.count).toBe(1));
    expect(loadOperationalNotifications).toHaveBeenCalledOnce();
    expect(getNotifications).not.toHaveBeenCalled();
  });
});