import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), conversations: vi.fn(), messages: vi.fn(), send: vi.fn(), observer: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../access/DepartmentAccessContext', () => ({ useOptionalDepartmentAccess: () => ({ can: () => true }) }));
vi.mock('./chatService', () => ({ readConversations: mocks.conversations, readMessages: mocks.messages, sendMessage: mocks.send }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: mocks.observer,
}));
vi.mock('../../components/AppLink', () => ({
  default: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));

import CanonicalChatRoute from './CanonicalChatRoute';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const operationId = '70000000-0000-0000-0000-000000000001';
const operation = { operationId, operationCode: 'DEV-CHAT-01', stationId: '20000000-0000-0000-0000-000000000003', stationCode: 'PUJ', airlineName: 'Airline', agentName: 'Ramp', lastMessage: null };
const message = (id, content) => ({ id, senderName: 'OCC', senderRole: 'occ', sentAt: '2026-09-01T12:00:00Z', content });

beforeEach(() => window.history.replaceState({}, '', '/admin-occ/chat'));

afterEach(() => {
  vi.useRealTimers();
  act(() => resetLanguageForTests('es'));
});

it('keeps each draft and uncertain command when navigating during a send, then retries the same key', async () => {
  const other = { ...operation, operationId: '70000000-0000-0000-0000-000000000002', operationCode: 'DEV-CHAT-02' };
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  mocks.useAuth.mockReturnValue({ session: { accountId: '10000000-0000-0000-0000-000000000001', stationScopes: [{ stationId: operation.stationId, stationCode: 'PUJ' }] } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.conversations.mockReset().mockResolvedValue({ conversations: [operation, other], hasMore: false });
  mocks.messages.mockReset().mockResolvedValue({ messages: [], hasMore: false });
  mocks.send.mockReset().mockReturnValueOnce(pending).mockResolvedValueOnce({ ...message('confirmed', 'Draft A'), operationId });
  window.history.replaceState({}, '', '/admin-occ/chat');
  render(<CanonicalChatRoute />);
  fireEvent.click(await screen.findByRole('button', { name: /DEV-CHAT-01/ }));
  await screen.findByText('Sin mensajes todavía.');
  fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Draft A' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enviar mensaje' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
  fireEvent.click(screen.getByRole('button', { name: /DEV-CHAT-02/ }));
  fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Draft B' } });
  fireEvent.click(screen.getByRole('button', { name: /DEV-CHAT-01/ }));
  expect(screen.getByLabelText('Mensaje')).toHaveValue('Draft A');
  expect(screen.getByLabelText('Mensaje')).toBeDisabled();
  await act(async () => { reject(new Error('uncertain')); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar envío' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar envío' }));
  await screen.findByText('Draft A', { selector: 'article p' });
  expect(mocks.send.mock.calls[1].slice(0, 3)).toEqual(mocks.send.mock.calls[0].slice(0, 3));
  fireEvent.click(screen.getByRole('button', { name: /DEV-CHAT-02/ }));
  expect(screen.getByLabelText('Mensaje')).toHaveValue('Draft B');
});

it('coalesces periodic chat reads while a request is pending', async () => {
  const first = deferred();
  mocks.useAuth.mockReturnValue({ session: {
    accountId: '10000000-0000-0000-0000-000000000001',
    stationScopes: [{ stationId: operation.stationId, stationCode: 'PUJ' }],
  } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.conversations.mockReset().mockResolvedValue({ conversations: [operation], hasMore: false });
  mocks.messages.mockReset().mockReturnValueOnce(first.promise);
  vi.useFakeTimers();

  render(<CanonicalChatRoute />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /DEV-CHAT-01/ }));
  expect(mocks.messages).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(mocks.messages).toHaveBeenCalledTimes(1);

  await act(async () => first.resolve({ messages: [message('new', 'Nuevo resultado')], hasMore: false }));
  expect(screen.getByText('Nuevo resultado')).toBeInTheDocument();
  expect(screen.queryByText('Resultado antiguo')).not.toBeInTheDocument();
});

it('renders conversations and messages in English inside the OCC scope', async () => {
  const conversationsRead = deferred();
  const messagesRead = deferred();
  mocks.useAuth.mockReturnValue({ session: {
    accountId: '10000000-0000-0000-0000-000000000001',
    stationScopes: [{ stationId: operation.stationId, stationCode: 'PUJ' }],
  } });
  mocks.observer.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  mocks.conversations.mockReset().mockReturnValue(conversationsRead.promise);
  mocks.messages.mockReset().mockReturnValue(messagesRead.promise);
  window.history.replaceState({}, '', '/admin-occ/chat');
  act(() => resetLanguageForTests('en'));

  render(<LanguageScope><CanonicalChatRoute /></LanguageScope>);
  expect(await screen.findByRole('heading', { name: 'Operational chat' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading conversations…');
  const preview = screen.findByText('Airline · No messages');
  await act(async () => conversationsRead.resolve({ conversations: [operation], hasMore: false }));
  expect(await preview).toBeInTheDocument();
  expect(screen.getByText('Select an operation to see its messages.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /DEV-CHAT-01/ }));
  expect(screen.getByText('Loading messages…')).toBeInTheDocument();
  await act(async () => messagesRead.resolve({ messages: [{ ...message('agent', 'Ready'), senderName: 'Ramp', senderRole: 'agent' }], hasMore: false }));
  expect(await screen.findByText(/Ramp · Agent ·/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View operation' })).toBeInTheDocument();
  expect(screen.getByLabelText('Message')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});
