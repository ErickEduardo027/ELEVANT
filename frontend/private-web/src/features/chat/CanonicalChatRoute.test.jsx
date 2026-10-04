import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), conversations: vi.fn(), messages: vi.fn(), send: vi.fn(), observer: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../services/operationalCommunicationService', () => ({
  loadOperationalConversations: mocks.conversations,
  loadOperationalMessages: mocks.messages,
  sendOperationalMessage: mocks.send,
}));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: mocks.observer,
}));
vi.mock('../../components/AppLink', () => ({
  default: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));

import CanonicalChatRoute from './CanonicalChatRoute';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const operationId = '70000000-0000-0000-0000-000000000001';
const operation = { operationId, operationCode: 'DEV-CHAT-01', stationId: '20000000-0000-0000-0000-000000000003', stationCode: 'PUJ', airlineName: 'Airline', agentName: 'Ramp', lastMessage: null };
const message = (id, content) => ({ id, senderName: 'OCC', senderRole: 'occ', sentAt: '2026-09-01T12:00:00Z', content });

afterEach(() => vi.useRealTimers());

it('keeps the newest message when periodic chat reads finish out of order', async () => {
  const first = deferred();
  const second = deferred();
  mocks.useAuth.mockReturnValue({ session: {
    accountId: '10000000-0000-0000-0000-000000000001',
    stationScopes: [{ stationId: operation.stationId, stationCode: 'PUJ' }],
  } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.conversations.mockReset().mockResolvedValue({ conversations: [operation], hasMore: false });
  mocks.messages.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.useFakeTimers();

  render(<CanonicalChatRoute />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /DEV-CHAT-01/ }));
  expect(mocks.messages).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(mocks.messages).toHaveBeenCalledTimes(2);

  await act(async () => second.resolve({ messages: [message('new', 'Nuevo resultado')], hasMore: false }));
  await act(async () => first.resolve({ messages: [message('old', 'Resultado antiguo')], hasMore: false }));
  expect(screen.getByText('Nuevo resultado')).toBeInTheDocument();
  expect(screen.queryByText('Resultado antiguo')).not.toBeInTheDocument();
});
