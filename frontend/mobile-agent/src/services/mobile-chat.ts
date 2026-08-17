import { ChatMessage, getChatMessages, saveChatMessages } from '../storage/prototype-storage';
import { getMobileSession, MOBILE_API_URL } from './mobile-auth';

type ApiChatMessage = {
  id: string;
  clientId?: string | null;
  senderRole: 'agent' | 'occ';
  content: string;
  createdAt: string;
};

export async function refreshOccChat(): Promise<ChatMessage[]> {
  const session = await getMobileSession();
  if (!session?.token) return getChatMessages();
  const response = await fetch(`${MOBILE_API_URL}/api/mobile/chat`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No fue posible actualizar el chat con OCC.');

  const remote = ((payload.messages ?? []) as ApiChatMessage[]).map(message => ({
    id: message.clientId || message.id,
    sender: message.senderRole === 'agent' ? 'agent' as const : 'occ' as const,
    text: message.content,
    createdAt: message.createdAt,
    pending: false,
  }));
  const local = await getChatMessages();
  const remoteIds = new Set(remote.map(message => message.id));
  const pending = local.filter(message => message.pending && !remoteIds.has(message.id));
  const merged = [...remote, ...pending].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  await saveChatMessages(merged);
  return merged;
}
