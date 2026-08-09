import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  checklist: 'elevant:checklist:',
  flightState: 'elevant:flight:',
  outbox: 'elevant:outbox',
};

export type OutboxItem = { id: string; type: string; summary: string; createdAt: string };

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) as T : fallback;
}

export async function setJson<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const checklistKey = (flightId: string) => `${KEYS.checklist}${flightId}`;
export const flightKey = (flightId: string) => `${KEYS.flightState}${flightId}`;

export async function addToOutbox(type: string, summary: string) {
  const items = await getJson<OutboxItem[]>(KEYS.outbox, []);
  const item = { id: `${Date.now()}-${Math.random()}`, type, summary, createdAt: new Date().toISOString() };
  await setJson(KEYS.outbox, [item, ...items]);
  return item;
}

export async function getOutbox() {
  return getJson<OutboxItem[]>(KEYS.outbox, []);
}

export async function clearOutbox() {
  await setJson(KEYS.outbox, []);
}
