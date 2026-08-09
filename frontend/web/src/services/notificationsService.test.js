import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetNotificationsStoreForTests,
  getNotification,
  getNotificationPreferences,
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  markNotificationAsUnread,
  markNotificationsAsRead,
  markNotificationsAsUnread,
  updateNotificationPreferences,
} from './notificationsService';

afterEach(() => {
  __resetNotificationsStoreForTests();
});

describe('getNotifications', () => {
  it('resolves with a station and a notifications array shaped like the documented contract', async () => {
    const snapshot = await getNotifications();
    expect(snapshot).toEqual(
      expect.objectContaining({
        station: expect.objectContaining({ code: 'PUJ' }),
        notifications: expect.any(Array),
      })
    );
    expect(snapshot.notifications.length).toBeGreaterThanOrEqual(12);
    for (const notification of snapshot.notifications) {
      expect(notification).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          category: expect.stringMatching(/^(operational|review|system|personal|general)$/),
          severity: expect.stringMatching(/^(info|warning|critical|success)$/),
          title: expect.any(String),
          description: expect.any(String),
          read: expect.any(Boolean),
          createdAt: expect.any(String),
        })
      );
    }
  });

  it('covers every documented category and severity at least once', async () => {
    const { notifications } = await getNotifications();
    expect(new Set(notifications.map(n => n.category))).toEqual(
      new Set(['operational', 'review', 'system', 'personal', 'general'])
    );
    expect(new Set(notifications.map(n => n.severity))).toEqual(
      new Set(['info', 'warning', 'critical', 'success'])
    );
  });

  it('includes both read and unread notifications, and both navigable and non-navigable ones', async () => {
    const { notifications } = await getNotifications();
    expect(notifications.some(n => n.read)).toBe(true);
    expect(notifications.some(n => !n.read)).toBe(true);
    expect(notifications.some(n => n.relatedModule)).toBe(true);
    expect(notifications.some(n => !n.relatedModule)).toBe(true);
  });
});

describe('getNotification', () => {
  it('resolves a single notification by id', async () => {
    const notification = await getNotification('NOT-2001');
    expect(notification.id).toBe('NOT-2001');
  });

  it('rejects for an unknown id', async () => {
    await expect(getNotification('NOT-9999')).rejects.toThrow();
  });
});

describe('markNotificationAsRead / markNotificationAsUnread', () => {
  it('flips the read flag and is idempotent', async () => {
    const read = await markNotificationAsRead('NOT-2001');
    expect(read.read).toBe(true);
    const readAgain = await markNotificationAsRead('NOT-2001');
    expect(readAgain.read).toBe(true);

    const unread = await markNotificationAsUnread('NOT-2001');
    expect(unread.read).toBe(false);
  });

  it('persists the change in the store', async () => {
    await markNotificationAsRead('NOT-2002');
    const { notifications } = await getNotifications();
    expect(notifications.find(n => n.id === 'NOT-2002').read).toBe(true);
  });
});

describe('markNotificationsAsRead / markNotificationsAsUnread', () => {
  it('only touches the given ids', async () => {
    await markNotificationsAsRead(['NOT-2001', 'NOT-2002']);
    const { notifications } = await getNotifications();
    expect(notifications.find(n => n.id === 'NOT-2001').read).toBe(true);
    expect(notifications.find(n => n.id === 'NOT-2002').read).toBe(true);
    expect(notifications.find(n => n.id === 'NOT-2007').read).toBe(false);

    await markNotificationsAsUnread(['NOT-2001']);
    const after = await getNotifications();
    expect(after.notifications.find(n => n.id === 'NOT-2001').read).toBe(false);
    expect(after.notifications.find(n => n.id === 'NOT-2002').read).toBe(true);
  });
});

describe('markAllNotificationsAsRead', () => {
  it('leaves zero unread notifications', async () => {
    const updated = await markAllNotificationsAsRead();
    expect(updated.every(n => n.read)).toBe(true);
    const { notifications } = await getNotifications();
    expect(notifications.every(n => n.read)).toBe(true);
  });
});

describe('notification preferences', () => {
  it('round-trips updates through getNotificationPreferences', async () => {
    const initial = await getNotificationPreferences();
    expect(initial.system).toBe('show');

    const updated = await updateNotificationPreferences({ system: 'mute' });
    expect(updated.system).toBe('mute');

    const fetched = await getNotificationPreferences();
    expect(fetched.system).toBe('mute');
    expect(fetched.operational).toBe('show');
  });
});

describe('__resetNotificationsStoreForTests', () => {
  it('restores the original read/unread state and preferences', async () => {
    await markAllNotificationsAsRead();
    await updateNotificationPreferences({ system: 'mute' });
    __resetNotificationsStoreForTests();

    const { notifications } = await getNotifications();
    expect(notifications.some(n => !n.read)).toBe(true);
    expect((await getNotificationPreferences()).system).toBe('show');
  });
});
