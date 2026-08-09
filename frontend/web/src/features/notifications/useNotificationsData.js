import { useCallback, useEffect, useState } from 'react';
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  markNotificationAsUnread,
  markNotificationsAsRead,
  markNotificationsAsUnread,
} from '../../services/notificationsService';

export function useNotificationsData(stationCode = 'PUJ', refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const load = useCallback(() => {
    setState(current => ({ ...current, status: 'loading', error: null }));
    return getNotifications(stationCode)
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => setState({ status: 'error', data: null, error }));
  }, [stationCode]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  function patchNotifications(updater) {
    setState(current =>
      current.data ? { ...current, data: { ...current.data, notifications: updater(current.data.notifications) } } : current
    );
  }

  const markAsRead = useCallback(async id => {
    const updated = await markNotificationAsRead(id);
    patchNotifications(notifications => notifications.map(item => (item.id === id ? updated : item)));
    return updated;
  }, []);

  const markAsUnread = useCallback(async id => {
    const updated = await markNotificationAsUnread(id);
    patchNotifications(notifications => notifications.map(item => (item.id === id ? updated : item)));
    return updated;
  }, []);

  const markManyAsRead = useCallback(async ids => {
    const updated = await markNotificationsAsRead(ids);
    patchNotifications(notifications => notifications.map(item => updated.find(u => u.id === item.id) ?? item));
    return updated;
  }, []);

  const markManyAsUnread = useCallback(async ids => {
    const updated = await markNotificationsAsUnread(ids);
    patchNotifications(notifications => notifications.map(item => updated.find(u => u.id === item.id) ?? item));
    return updated;
  }, []);

  const markAllAsRead = useCallback(async () => {
    const updated = await markAllNotificationsAsRead();
    patchNotifications(() => updated);
    return updated;
  }, []);

  return { ...state, refresh: load, markAsRead, markAsUnread, markManyAsRead, markManyAsUnread, markAllAsRead };
}
