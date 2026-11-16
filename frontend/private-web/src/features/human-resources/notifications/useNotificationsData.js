import { useCallback, useEffect, useState } from 'react';
import {
  getHumanResourcesNotificationPreferences,
  getHumanResourcesNotifications,
  markAllHumanResourcesNotificationsAsRead,
  markHumanResourcesNotificationAsRead,
  markHumanResourcesNotificationAsUnread,
  markHumanResourcesNotificationsAsRead,
  markHumanResourcesNotificationsAsUnread,
  updateHumanResourcesNotificationPreferences,
} from '../../../services/humanResourcesNotificationsService';

export function useNotificationsData(stationCode = 'PUJ', refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [preferences, setPreferences] = useState(null);

  const refresh = useCallback(() => {
    setState(current => ({ ...current, status: 'loading', error: null }));
    return getHumanResourcesNotifications(stationCode)
      .then(data => setState({ status: 'success', data, error: null }))
      .catch(error => setState({ status: 'error', data: null, error }));
  }, [stationCode]);

  useEffect(() => {
    refresh();
    getHumanResourcesNotificationPreferences().then(setPreferences);
  }, [refresh, refreshToken]);

  function patchNotifications(updater) {
    setState(current =>
      current.data ? { ...current, data: { ...current.data, notifications: updater(current.data.notifications) } } : current
    );
  }

  const markAsRead = useCallback(async id => {
    const updated = await markHumanResourcesNotificationAsRead(id);
    patchNotifications(notifications => notifications.map(item => (item.id === id ? updated : item)));
    return updated;
  }, []);

  const markAsUnread = useCallback(async id => {
    const updated = await markHumanResourcesNotificationAsUnread(id);
    patchNotifications(notifications => notifications.map(item => (item.id === id ? updated : item)));
    return updated;
  }, []);

  const markManyAsRead = useCallback(async ids => {
    const updated = await markHumanResourcesNotificationsAsRead(ids);
    patchNotifications(notifications => notifications.map(item => updated.find(u => u.id === item.id) ?? item));
    return updated;
  }, []);

  const markManyAsUnread = useCallback(async ids => {
    const updated = await markHumanResourcesNotificationsAsUnread(ids);
    patchNotifications(notifications => notifications.map(item => updated.find(u => u.id === item.id) ?? item));
    return updated;
  }, []);

  const markAllAsRead = useCallback(async () => {
    const updated = await markAllHumanResourcesNotificationsAsRead();
    patchNotifications(() => updated);
    return updated;
  }, []);

  const updatePreferences = useCallback(async nextPreferences => {
    const updated = await updateHumanResourcesNotificationPreferences(nextPreferences);
    setPreferences(updated);
    return updated;
  }, []);

  return {
    ...state,
    preferences,
    refresh,
    markAsRead,
    markAsUnread,
    markManyAsRead,
    markManyAsUnread,
    markAllAsRead,
    updatePreferences,
  };
}

