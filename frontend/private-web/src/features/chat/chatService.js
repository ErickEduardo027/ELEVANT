import { requestForAuthSession } from '../auth/requestForAuthSession';

export const readConversations = (stationId, options) => requestForAuthSession(client => client.getOperationalConversations(stationId, options), options);
export const readMessages = (operationId, options) => requestForAuthSession(client => client.getOperationalMessages(operationId, options), options);
export const markConversationRead = (operationId, messageId, options) => requestForAuthSession(
  client => client.markOperationalConversationRead(operationId, messageId, options), options,
);
export const sendMessage = (operationId, content, idempotencyKey, options) => requestForAuthSession(
  client => client.sendOperationalMessage(operationId, { content }, idempotencyKey, undefined, options), options,
);
