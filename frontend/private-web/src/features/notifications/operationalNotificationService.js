import { requestForAuthSession } from '../auth/requestForAuthSession';

export const loadOperationalNotifications = options => requestForAuthSession(
  client => client.getOperationalNotifications(options), options,
);
export const setOperationalNotificationRead = (id, read, options) => requestForAuthSession(
  client => client.setOperationalNotificationRead(id, read, options), options,
);
