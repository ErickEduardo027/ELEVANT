import {
  HUMAN_RESOURCES_NOTIFICATION_DEFAULT_PREFERENCES,
  HUMAN_RESOURCES_NOTIFICATIONS_MOCK,
} from '../features/human-resources/notifications/notificationsMock';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeIdSet(ids) {
  return new Set(ids.filter(Boolean));
}

let store = HUMAN_RESOURCES_NOTIFICATIONS_MOCK.map(clone);
let preferences = { ...HUMAN_RESOURCES_NOTIFICATION_DEFAULT_PREFERENCES };
const listeners = new Set();

function emitChange() {
  listeners.forEach(listener => listener());
}

function findNotificationIndex(id) {
  return store.findIndex(notification => notification.id === id);
}

function updateNotificationReadState(id, read) {
  const index = findNotificationIndex(id);
  if (index === -1) throw new Error(`No existe la notificación ${id}`);

  const current = store[index];
  if (current.read === read) return clone(current);

  const next = { ...current, read };
  store = [...store.slice(0, index), next, ...store.slice(index + 1)];
  emitChange();
  return clone(next);
}

function updateManyNotificationsReadState(ids, read) {
  const idSet = normalizeIdSet(ids);
  const missingIds = [...idSet].filter(id => findNotificationIndex(id) === -1);
  if (missingIds.length > 0) {
    throw new Error(`No existe la notificación ${missingIds[0]}`);
  }

  let changed = false;
  store = store.map(notification => {
    if (!idSet.has(notification.id) || notification.read === read) return notification;
    changed = true;
    return { ...notification, read };
  });

  if (changed) emitChange();
  return [...idSet].map(id => clone(store.find(notification => notification.id === id)));
}

function computeUnreadCount() {
  return store.filter(notification => !notification.read).length;
}

export function subscribeHumanResourcesNotifications(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getHumanResourcesNotifications(stationCode = 'PUJ') {
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    notifications: store.map(clone),
    unreadCount: computeUnreadCount(),
  };
}

export async function getHumanResourcesNotification(id) {
  const notification = store.find(item => item.id === id);
  if (!notification) throw new Error(`No existe la notificación ${id}`);
  return clone(notification);
}

export async function getHumanResourcesUnreadNotificationsCount() {
  return computeUnreadCount();
}

export async function markHumanResourcesNotificationAsRead(id) {
  return updateNotificationReadState(id, true);
}

export async function markHumanResourcesNotificationAsUnread(id) {
  return updateNotificationReadState(id, false);
}

export async function markHumanResourcesNotificationsAsRead(ids) {
  return updateManyNotificationsReadState(ids, true);
}

export async function markHumanResourcesNotificationsAsUnread(ids) {
  return updateManyNotificationsReadState(ids, false);
}

export async function markAllHumanResourcesNotificationsAsRead() {
  const nextStore = store.map(notification => (notification.read ? notification : { ...notification, read: true }));
  const changed = nextStore.some((notification, index) => notification !== store[index]);
  store = nextStore;
  if (changed) emitChange();
  return store.map(clone);
}

export async function getHumanResourcesNotificationPreferences() {
  return { ...preferences };
}

export async function updateHumanResourcesNotificationPreferences(nextPreferences) {
  preferences = { ...preferences, ...nextPreferences };
  emitChange();
  return { ...preferences };
}

export function __resetHumanResourcesNotificationsStoreForTests() {
  store = HUMAN_RESOURCES_NOTIFICATIONS_MOCK.map(clone);
  preferences = { ...HUMAN_RESOURCES_NOTIFICATION_DEFAULT_PREFERENCES };
  emitChange();
}
