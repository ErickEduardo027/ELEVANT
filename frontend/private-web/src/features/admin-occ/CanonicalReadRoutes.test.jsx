import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from '../../../tests/MemoryRouter.jsx';

const mocks = vi.hoisted(() => ({ session: vi.fn(), loadQueue: vi.fn(),
  loadConversations: vi.fn(), loadMessages: vi.fn(), sendMessage: vi.fn(),
  loadNotifications: vi.fn(), setNotificationRead: vi.fn(), observe: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: mocks.session() }) }));
vi.mock('../../services/occReviewService', () => ({ loadOccReviewQueue: mocks.loadQueue }));
// The chat (kept from #156) reads through chatService; notifications keep the original service.
vi.mock('../chat/chatService', () => ({
  readConversations: mocks.loadConversations,
  readMessages: mocks.loadMessages,
  sendMessage: mocks.sendMessage,
}));
vi.mock('../access/DepartmentAccessContext', () => ({ useOptionalDepartmentAccess: () => ({ can: () => true }) }));
vi.mock('../../services/operationalCommunicationService', () => ({
  loadOperationalNotifications: mocks.loadNotifications,
  setOperationalNotificationRead: mocks.setNotificationRead,
}));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: mocks.observe,
}));

import CanonicalNotificationsRoute from '../notifications/CanonicalNotificationsRoute';
import CanonicalChatRoute from '../chat/CanonicalChatRoute';

const stationId = '20000000-0000-0000-0000-000000000001';
const operationId = '70000000-0000-0000-0000-000000000001';
const notificationId = '90000000-0000-0000-0000-000000000001';
const message = { id: 'a0000000-0000-0000-0000-000000000001', operationId,
  senderAccountId: 'b0000000-0000-0000-0000-000000000001', senderRole: 'agent',
  senderName: 'Agente Uno', content: 'Puente listo', sentAt: '2026-09-24T10:00:00Z' };
const notification = { id: notificationId, operationId, operationCode: 'OP-101',
  stationCode: 'PUJ', kind: 'agent_message', sourceId: message.id,
  occurredAt: message.sentAt, readAt: null };
const rows = [
  { operationId, submissionId: '80000000-0000-0000-0000-000000000001', revisionNumber: 1,
    status: 'Approved', operationCode: 'OP-101', operationDate: '2026-09-24',
    airlineName: 'Demo Airline', agentName: 'Agente Uno', submittedAt: message.sentAt,
    serviceCount: 2, incidentCount: 1 },
  { operationId: '70000000-0000-0000-0000-000000000002',
    submissionId: '80000000-0000-0000-0000-000000000002', revisionNumber: 2,
    status: 'PendingReview', operationCode: 'OP-102', operationDate: '2026-09-24',
    airlineName: 'Demo Airline', agentName: 'Agente Dos', submittedAt: message.sentAt,
    serviceCount: 1, incidentCount: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.observe.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
  mocks.session.mockReturnValue({ stationScopes: [{ stationId, stationCode: 'PUJ' }] });
  mocks.loadQueue.mockResolvedValue({ stationId, stationCode: 'PUJ', ianaTimeZone: 'America/Santo_Domingo', operations: rows, hasMore: false });
  mocks.loadConversations.mockResolvedValue({ conversations: [{ operationId,
    operationCode: 'OP-101', operationDate: '2026-09-24', stationCode: 'PUJ',
    airlineName: 'Demo Airline', agentName: 'Agente Uno', status: 'InProgress',
    lastMessage: message }], hasMore: false });
  mocks.loadMessages.mockResolvedValue({ operationId, messages: [message], hasMore: false });
  mocks.sendMessage.mockResolvedValue(message);
  mocks.loadNotifications.mockResolvedValue({ notifications: [notification], hasMore: false });
  mocks.setNotificationRead.mockResolvedValue({ ...notification, readAt: message.sentAt });
});
afterEach(() => vi.restoreAllMocks());

describe('OCC canonical read surfaces', () => {
  it('invalidates the notification list when the authorized feed reports a change', async () => {
    mocks.session.mockReturnValue({ accountId: 'b0000000-0000-0000-0000-000000000001',
      stationScopes: [{ stationId, stationCode: 'PUJ' }] });
    render(<MemoryRouter><CanonicalNotificationsRoute /></MemoryRouter>);
    await waitFor(() => expect(mocks.loadNotifications).toHaveBeenCalledTimes(1));
    expect(mocks.observe).toHaveBeenCalledOnce();
    mocks.observe.mock.calls[0][0](['notifications']);
    await waitFor(() => expect(mocks.loadNotifications).toHaveBeenCalledTimes(2));
  });

  it('shows durable account notifications and stores the read receipt', async () => {
    render(<MemoryRouter><CanonicalNotificationsRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Nuevo mensaje del agente')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Abrir' })).toHaveAttribute('href', `/admin-occ/chat?operationId=${operationId}`);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar leída' }));
    await waitFor(() => expect(mocks.setNotificationRead).toHaveBeenCalledWith(notificationId, true));
    expect(await screen.findByRole('button', { name: 'Marcar no leída' })).toBeInTheDocument();
  });

  it('loads messages and sends one idempotent OCC message', async () => {
    render(<MemoryRouter initialEntries={[`/admin-occ/chat?operationId=${operationId}`]}><CanonicalChatRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText('Puente listo').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('Mensaje'), { target: { value: 'Llegaré en dos minutos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith(operationId,
      'Llegaré en dos minutos', expect.stringMatching(/^[0-9a-f-]{36}$/i)));
  });

  it('refreshes the selected conversation when the feed reports a message', async () => {
    mocks.session.mockReturnValue({ accountId: 'b0000000-0000-0000-0000-000000000001',
      stationScopes: [{ stationId, stationCode: 'PUJ' }] });
    render(<MemoryRouter initialEntries={[`/admin-occ/chat?operationId=${operationId}`]}><CanonicalChatRoute /></MemoryRouter>);
    await waitFor(() => expect(mocks.loadMessages).toHaveBeenCalledTimes(1));
    mocks.observe.mock.calls[0][0](['operation_messages']);
    await waitFor(() => expect(mocks.loadMessages).toHaveBeenCalledTimes(2));
    expect(mocks.loadConversations).toHaveBeenCalledTimes(2);
  });

  it('never requests a station outside the authenticated scope', async () => {
    mocks.session.mockReturnValue({ stationScopes: [] });
    render(<MemoryRouter><CanonicalChatRoute /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/no tiene una estación OCC autorizada/)).toBeInTheDocument());
    expect(mocks.loadConversations).not.toHaveBeenCalled();
  });
});
