import { completeSynchronization, getOutbox } from '../storage/prototype-storage';
import { getMobileSession, MOBILE_API_URL } from './mobile-auth';

let activeRequest: Promise<{ synchronizedAt: string; count: number }> | null = null;

export async function synchronizePendingRecords() {
  if (activeRequest) return activeRequest;
  activeRequest = (async () => {
    const [session, items] = await Promise.all([getMobileSession(), getOutbox()]);
    if (!session?.token || !items.length) return { synchronizedAt: new Date().toISOString(), count: 0 };

    const response = await fetch(`${MOBILE_API_URL}/api/mobile/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ items }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'No fue posible sincronizar los registros.');
    return completeSynchronization(payload.accepted ?? [], payload.synchronizedAt ?? new Date().toISOString());
  })();
  try {
    return await activeRequest;
  } finally {
    activeRequest = null;
  }
}
