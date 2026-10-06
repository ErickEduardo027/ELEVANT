import { afterEach, describe, expect, it } from 'vitest';
import { __resetContractCommunicationsForTests, getContractConversations, markContractConversationRead, sendContractMessage } from './contractCommunicationsService';

afterEach(() => __resetContractCommunicationsForTests());

describe('contractCommunicationsService', () => {
  it('marks a conversation as read', async () => {
    expect((await markContractConversationRead('CONV-01')).unreadCount).toBe(0);
  });

  it('sends a message as the contracts department', async () => {
    const updated = await sendContractMessage('CONV-02', 'Confirmamos la condición contractual.');
    expect(updated.messages.at(-1).sender).toBe('Departamento de Contratos');
    expect((await getContractConversations()).find(item => item.id === 'CONV-02').messages.at(-1).text).toContain('Confirmamos');
  });
});