import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  checklist: 'elevant:checklist:',
  flightState: 'elevant:flight:',
  outbox: 'elevant:outbox',
  chat: 'elevant:chat:occ',
};

export type OutboxItem = {
  id: string;
  idempotencyKey: string;
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
  attemptCount: number;
  lastError?: string;
};

export type ChecklistAnswer = 'OK' | 'NA' | 'NO';
export type ChecklistRecord = {
  answers: Record<string, ChecklistAnswer>;
  completedAt?: string;
};

export type OperationState = {
  startedAt?: string;
  endedAt?: string;
  syncedAt?: string;
};

export type ChatMessage = {
  id: string;
  sender: 'agent' | 'occ';
  text: string;
  createdAt: string;
  pending?: boolean;
};

export async function getJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) as T : fallback;
}

export async function setJson<T>(key: string, value: T) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const checklistKey = (flightId: string) => `${KEYS.checklist}${flightId}`;
export const flightKey = (flightId: string) => `${KEYS.flightState}${flightId}`;

export async function getChecklist(flightId: string): Promise<ChecklistRecord> {
  const stored = await getJson<ChecklistRecord | Record<string, ChecklistAnswer>>(checklistKey(flightId), {});
  if ('answers' in stored) return stored as ChecklistRecord;
  return { answers: stored as Record<string, ChecklistAnswer> };
}

export async function saveChecklist(flightId: string, record: ChecklistRecord) {
  await setJson(checklistKey(flightId), record);
}

export async function getOperationState(flightId: string, checklistTotal?: number): Promise<OperationState> {
  const state = await getJson<OperationState>(flightKey(flightId), {});
  if (state.endedAt && checklistTotal) {
    const checklist = await getChecklist(flightId);
    if (!checklist.completedAt || Object.keys(checklist.answers).length !== checklistTotal) {
      const corrected = { startedAt: state.startedAt };
      await setJson(flightKey(flightId), corrected);
      return corrected;
    }
  }
  if (state.endedAt && !state.syncedAt) {
    const pending = await getOutbox();
    const hasPendingCompletion = pending.some(item => item.type === 'operación' && item.payload?.flightId === flightId && Boolean(item.payload?.endedAt));
    if (!hasPendingCompletion) {
      const migrated = { ...state, syncedAt: state.endedAt };
      await setJson(flightKey(flightId), migrated);
      return migrated;
    }
  }
  return state;
}

export async function addToOutbox(type: string, summary: string, payload: Record<string, unknown> = {}) {
  const items = await getJson<OutboxItem[]>(KEYS.outbox, []);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item: OutboxItem = {
    id,
    idempotencyKey: id,
    type,
    summary,
    payload,
    createdAt: new Date().toISOString(),
    status: 'pending',
    attemptCount: 0,
  };
  await setJson(KEYS.outbox, [item, ...items]);
  return item;
}

export async function getOutbox() {
  return getJson<OutboxItem[]>(KEYS.outbox, []);
}

export async function clearOutbox() {
  await setJson(KEYS.outbox, []);
}

export async function completeMockSynchronization() {
  const items = await getOutbox();
  const synchronizedAt = new Date().toISOString();
  const completedFlightIds = new Set<string>();
  for (const item of items) {
    const flightId = typeof item.payload?.flightId === 'string' ? item.payload.flightId : undefined;
    if (item.type === 'operación' && flightId && item.payload?.endedAt) completedFlightIds.add(flightId);
  }
  await Promise.all([...completedFlightIds].map(async flightId => {
    const state = await getJson<OperationState>(flightKey(flightId), {});
    if (state.endedAt) await setJson(flightKey(flightId), { ...state, syncedAt: synchronizedAt });
  }));
  await clearOutbox();
  return { synchronizedAt, count: items.length };
}

export async function cancelOperationStart(flightId: string) {
  const items = await getOutbox();
  const remaining = items.filter(item => {
    const belongsToFlight = item.payload?.flightId === flightId;
    return !(belongsToFlight && (item.type === 'operación' || item.type === 'checklist'));
  });
  await Promise.all([
    AsyncStorage.removeItem(flightKey(flightId)),
    AsyncStorage.removeItem(checklistKey(flightId)),
    setJson(KEYS.outbox, remaining),
  ]);
}

export async function getChatMessages() {
  return getJson<ChatMessage[]>(KEYS.chat, []);
}

export async function saveChatMessages(messages: ChatMessage[]) {
  await setJson(KEYS.chat, messages);
}
