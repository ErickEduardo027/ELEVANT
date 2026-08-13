const BASE_URL = import.meta.env.VITE_PROTOTYPE_API_URL || '/api';
const TOKEN_KEY = 'elevant-prototype-token';

export function getPrototypeToken() {
  return window.localStorage.getItem(TOKEN_KEY) || window.sessionStorage.getItem(TOKEN_KEY);
}

export function savePrototypeToken(token, remember) {
  window.localStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
  (remember ? window.localStorage : window.sessionStorage).setItem(TOKEN_KEY, token);
}

export function clearPrototypeToken() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
}

export async function prototypeRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(getPrototypeToken() ? { authorization: `Bearer ${getPrototypeToken()}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('No se pudo conectar con backend-prototipo en el puerto 4310.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la operación.');
  return payload;
}

export const prototypeApi = {
  login: credentials => prototypeRequest('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }),
  bootstrap: () => prototypeRequest('/bootstrap'),
  data: collection => prototypeRequest(`/data/${collection}`),
  reviewRequest: id => prototypeRequest(`/requests/${id}/review`, { method: 'POST' }),
  decideRequest: (id, payload) => prototypeRequest(`/requests/${id}/decision`, { method: 'POST', body: JSON.stringify(payload) }),
  allocatePersonnel: payload => prototypeRequest('/hr/allocations', { method: 'POST', body: JSON.stringify(payload) }),
  assignFlight: (id, payload) => prototypeRequest(`/flights/${id}/assign`, { method: 'POST', body: JSON.stringify(payload) }),
  reviewOperation: (id, payload) => prototypeRequest(`/operations/${id}/review`, { method: 'POST', body: JSON.stringify(payload) }),
  createPreinvoice: payload => prototypeRequest('/preinvoices', { method: 'POST', body: JSON.stringify(payload) }),
  transitionPreinvoice: (id, action) => prototypeRequest(`/preinvoices/${id}/${action}`, { method: 'POST' }),
  chats: () => prototypeRequest('/chats'),
  createChat: payload => prototypeRequest('/chats', { method: 'POST', body: JSON.stringify(payload) }),
  sendMessage: (id, text) => prototypeRequest(`/chats/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  reportUrl: format => `${BASE_URL}/reports/export?format=${format}`,
};
