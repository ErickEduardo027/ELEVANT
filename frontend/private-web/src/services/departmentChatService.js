import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';

async function request(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${PROTOTYPE_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la comunicación departamental.');
  return payload;
}

export function getDepartmentMessages() {
  return request('/api/internal-chat/messages');
}

export function sendDepartmentMessage(payload) {
  return request('/api/internal-chat/messages', { method: 'POST', body: JSON.stringify(payload) });
}

export function markDepartmentMessageRead(messageId) {
  return request(`/api/internal-chat/messages/${messageId}/read`, { method: 'POST' });
}
