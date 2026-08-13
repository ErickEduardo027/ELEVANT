import AsyncStorage from '@react-native-async-storage/async-storage';
import { OutboxItem } from '../storage/prototype-storage';

const API_URL = process.env.EXPO_PUBLIC_PROTOTYPE_API_URL || 'http://10.0.2.2:4310/api';
const TOKEN_KEY = 'elevant:prototype-token';

async function request(path: string, options: RequestInit = {}) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible conectar con ELEVANT.');
  return payload;
}

export async function loginAgent(email: string, password: string) {
  const session = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (session.user.role !== 'AGENTE_RAMPA') throw new Error('Esta aplicación es exclusiva para agentes de rampa.');
  await AsyncStorage.setItem(TOKEN_KEY, session.token);
  return session;
}

export function synchronizeOutbox(items: OutboxItem[]) {
  return request('/mobile/sync', { method: 'POST', body: JSON.stringify({ items }) });
}
