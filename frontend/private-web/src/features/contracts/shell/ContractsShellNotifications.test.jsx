import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsShell from './ContractsShell';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { loadDepartmentNotifications, setDepartmentNotificationRead } from '../../../services/operationalCommunicationService';

const observers = vi.hoisted(() => []);
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: onChanges => { observers.push(onChanges); return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }; },
}));
vi.mock('../../../services/operationalCommunicationService', async importOriginal => ({
  ...(await importOriginal()),
  loadDepartmentNotifications: vi.fn(),
  setDepartmentNotificationRead: vi.fn(),
}));
vi.mock('../../../services/commercialGovernanceApi', () => ({
  getManagedContracts: vi.fn().mockResolvedValue({ page: 1, limit: 20, hasMore: false, contracts: [] }),
  getManagedDrafts: vi.fn().mockResolvedValue([]),
  activateManagedDraft: vi.fn(), updateManagedDraft: vi.fn(),
}));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../../services/contractsHomeService', () => ({
  getContractsHomeSnapshot: vi.fn().mockResolvedValue({ kpis: { pendingRequests: 0, approvedRequests: 0, pendingDrafts: 0, rejectedRequests: 0 },
    recentRequests: [], pendingDrafts: [] }),
}));

const alert = (id, kind, subject, readAt = null) => ({ id, department: 'contracts', kind, sourceId: `s-${id}`, subject,
  stationCode: null, occurredAt: '2026-11-02T12:00:00Z', readAt });

afterEach(() => { cleanup(); vi.clearAllMocks(); observers.length = 0; });

it('shows the bell count, pops a toast when an alert arrives and opens its module from «Abrir»', async () => {
  const old = alert('n-1', 'contract_signed', 'CT-001 · Demo Air');
  const fresh = alert('n-2', 'draft_comment', 'Arajet');
  loadDepartmentNotifications
    .mockResolvedValueOnce({ notifications: [old], unreadCount: 1 })
    .mockResolvedValue({ notifications: [fresh, old], unreadCount: 2 });
  setDepartmentNotificationRead.mockImplementation(async (id, read) => ({ ...(id === 'n-2' ? fresh : old), readAt: read ? '2026-11-02T12:05:00Z' : null }));

  render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('contracts', DepartmentPermissionCodes.contracts)}>
    <ContractsShell observeNotifications /></DepartmentAccessProvider>);

  expect(await screen.findByTestId('notifications-badge')).toHaveTextContent('1');
  // Opening the app does not replay old alerts as toasts.
  expect(screen.queryAllByRole('status').filter(item => /La aerolínea firmó un contrato/.test(item.textContent))).toHaveLength(0);

  // The change feed announces «notifications»: the list is re-read and only the new alert pops up.
  await act(async () => { observers.forEach(onChanges => onChanges(['notifications'])); });
  const toast = (await screen.findAllByRole('status')).find(item => item.textContent.includes('La aerolínea comentó un borrador: Arajet'));
  expect(toast).toBeDefined();
  expect(screen.getByTestId('notifications-badge')).toHaveTextContent('2');

  await userEvent.click(within(toast).getByRole('button', { name: 'Abrir' }));
  expect(setDepartmentNotificationRead).toHaveBeenCalledWith('n-2', true);
  expect(await screen.findByRole('heading', { name: 'Borradores' })).toBeInTheDocument();
});

it('lists alerts in the bell and marks them as read', async () => {
  loadDepartmentNotifications.mockResolvedValue({ notifications: [alert('n-1', 'permit_submitted', 'Demo Air')], unreadCount: 1 });
  setDepartmentNotificationRead.mockResolvedValue(alert('n-1', 'permit_submitted', 'Demo Air', '2026-11-02T12:05:00Z'));
  render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('contracts', DepartmentPermissionCodes.contracts)}>
    <ContractsShell observeNotifications /></DepartmentAccessProvider>);

  await userEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }));
  const item = (await screen.findByText('La aerolínea envió un permiso para verificar')).closest('li');
  await userEvent.click(within(item).getByRole('button', { name: 'Marcar como leída' }));
  expect(setDepartmentNotificationRead).toHaveBeenCalledWith('n-1', true);
  expect(await within(item).findByRole('button', { name: 'Marcar como no leída' })).toBeInTheDocument();
  expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
});

it('keeps the bell hidden without the «Notificaciones» option', async () => {
  const codes = DepartmentPermissionCodes.contracts.filter(code => code !== 'contracts.notifications.read');
  render(<DepartmentAccessProvider observe={false} initialAccess={{ ...administratorAccess('contracts', codes), kind: 'Member' }}>
    <ContractsShell observeNotifications /></DepartmentAccessProvider>);
  await screen.findByRole('navigation');
  expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
  expect(loadDepartmentNotifications).not.toHaveBeenCalled();
});
