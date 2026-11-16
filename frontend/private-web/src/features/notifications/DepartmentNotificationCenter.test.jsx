import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDepartmentNotificationCenter } from './DepartmentNotificationCenter';
import { loadDepartmentNotifications, setDepartmentNotificationRead } from '../../services/operationalCommunicationService';

let announce;
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: onChanges => { announce = onChanges; return { start: vi.fn(), stop: vi.fn() }; },
}));
vi.mock('../../services/operationalCommunicationService', () => ({
  loadDepartmentNotifications: vi.fn(), setDepartmentNotificationRead: vi.fn(),
}));

const old = { id: 'n-1', department: 'Contracts', kind: 'draft_comment', sourceId: 's-1', subject: 'Demo Air',
  stationCode: null, occurredAt: '2026-10-26T10:00:00Z', readAt: null };
const fresh = { ...old, id: 'n-2', kind: 'commercial_request', sourceId: 's-2', subject: 'Caribe Air' };

function Harness({ onOpen }) {
  const center = useDepartmentNotificationCenter({ onOpen });
  return <><button type="button" onClick={center.openPanel}>Campana {center.count}</button>{center.ui}</>;
}

beforeEach(() => {
  loadDepartmentNotifications.mockResolvedValueOnce({ notifications: [old], unreadCount: 1, hasMore: false })
    .mockResolvedValue({ notifications: [fresh, old], unreadCount: 2, hasMore: false });
  setDepartmentNotificationRead.mockImplementation(async id => ({ ...(id === fresh.id ? fresh : old), readAt: '2026-10-26T11:00:00Z' }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('pops up only alerts that arrive after the first read and opens their menu option', async () => {
  const onOpen = vi.fn();
  render(<Harness onOpen={onOpen} />);
  expect(await screen.findByRole('button', { name: 'Campana 1' })).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  await act(async () => { announce(['notifications']); });
  const toast = await screen.findByText('Nueva solicitud comercial: Caribe Air');
  expect(toast.closest('[role="status"]')).not.toContainElement(document.activeElement);
  expect(screen.getByRole('button', { name: 'Campana 2' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Abrir' }));
  expect(onOpen).toHaveBeenCalledWith({ moduleId: 'contracts-requests' });
  expect(setDepartmentNotificationRead).toHaveBeenCalledWith('n-2', true);
});

it('lists alerts in the drawer and marks them read', async () => {
  render(<Harness onOpen={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Campana 1' }));
  const drawer = screen.getByRole('dialog', { name: 'Notificaciones' });
  expect(drawer).toHaveTextContent('La aerolínea comentó un borrador');
  await userEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Campana 0' })).toBeInTheDocument());
});

it('explains when the account lacks the «Notificaciones» option', async () => {
  loadDepartmentNotifications.mockReset().mockRejectedValue(Object.assign(new Error('x'), { status: 403 }));
  render(<Harness onOpen={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: /Campana/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no incluye la opción «Notificaciones»');
});
