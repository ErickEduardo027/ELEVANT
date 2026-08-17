import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useNotificationsData } from './useNotificationsData';
import * as notificationsService from '../../services/notificationsService';
import { __resetNotificationsStoreForTests } from '../../services/notificationsService';

afterEach(() => {
  vi.restoreAllMocks();
  __resetNotificationsStoreForTests();
});

describe('useNotificationsData', () => {
  it('loads notifications and exposes them as success state', async () => {
    const { result } = renderHook(() => useNotificationsData());
    expect(result.current.status).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data.notifications.length).toBeGreaterThan(0);
  });

  it('exposes an error state when the service rejects', async () => {
    vi.spyOn(notificationsService, 'getNotifications').mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useNotificationsData());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error.message).toBe('network down');
  });

  it('reloads when refreshToken changes', async () => {
    const spy = vi.spyOn(notificationsService, 'getNotifications');
    const { rerender } = renderHook(({ token }) => useNotificationsData('PUJ', token), { initialProps: { token: 0 } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    rerender({ token: 1 });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it('markAsRead patches the notification in place without refetching the whole list', async () => {
    const { result } = renderHook(() => useNotificationsData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.markAsRead('NOT-2001');
    });

    const updated = result.current.data.notifications.find(n => n.id === 'NOT-2001');
    expect(updated.read).toBe(true);
  });

  it('markAsUnread patches the notification back to unread', async () => {
    const { result } = renderHook(() => useNotificationsData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.markAsUnread('NOT-2004');
    });

    const updated = result.current.data.notifications.find(n => n.id === 'NOT-2004');
    expect(updated.read).toBe(false);
  });

  it('markManyAsRead patches every notification in the batch', async () => {
    const { result } = renderHook(() => useNotificationsData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.markManyAsRead(['NOT-2001', 'NOT-2002']);
    });

    const ids = ['NOT-2001', 'NOT-2002'];
    const updated = result.current.data.notifications.filter(n => ids.includes(n.id));
    expect(updated.every(n => n.read)).toBe(true);
  });

  it('markAllAsRead leaves zero unread notifications', async () => {
    const { result } = renderHook(() => useNotificationsData());
    await waitFor(() => expect(result.current.status).toBe('success'));

    await act(async () => {
      await result.current.markAllAsRead();
    });

    expect(result.current.data.notifications.every(n => n.read)).toBe(true);
  });
});
