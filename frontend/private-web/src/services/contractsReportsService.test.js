import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getManagedContracts: vi.fn(), getManagedDraftOverview: vi.fn(), getCommercialRequestInbox: vi.fn() }));
const factory = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./commercialGovernanceApi', () => api);
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: factory.create }));
vi.mock('../features/auth/authService', () => ({ readSession: () => ({ token: 't' }) }));

import { contractReportsAvailable, getContractsReportIndicators } from './contractsReportsService';

const contract = (id, status, validTo) => ({ id, code: `C-${id}`, airline: `Aerolínea ${id}`, status,
  approvedVersions: [{ id: `v-${id}`, status: 'Approved', validTo }, { id: `old-${id}`, status: 'Superseded', validTo: '2026-11-25' }] });

beforeEach(() => {
  vi.clearAllMocks();
  api.getManagedContracts.mockImplementation(async page => (page === 1
    ? { page: 1, limit: 50, hasMore: true, contracts: [contract('a', 'Active', '2026-12-01'), contract('b', 'Active', '2027-06-30')] }
    : { page: 2, limit: 50, hasMore: false, contracts: [contract('c', 'Active', '2026-11-22'), contract('d', 'Draft', '2026-11-30')] }));
  api.getManagedDraftOverview.mockResolvedValue({ count: 3, recent: [] });
  api.getCommercialRequestInbox.mockResolvedValue({ counts: { pending: 2, inReview: 1, approved: 5, rejected: 1, cancelled: 1 } });
});

it('counts every contract of every page, the active ones that end within 30 days and the pending requests', async () => {
  const data = await getContractsReportIndicators({ now: new Date('2026-11-21T15:00:00Z') });
  expect(api.getManagedContracts).toHaveBeenCalledWith(1, 50);
  expect(api.getManagedContracts).toHaveBeenCalledWith(2, 50);
  expect(data).toMatchObject({ today: '2026-11-21', limit: '2026-12-21', complete: true, contracts: 4, active: 3, drafts: 3,
    requests: { pending: 3, approved: 5, total: 10 } });
  // The superseded version never counts; a draft contract is not active.
  expect(data.expiring.map(item => [item.id, item.daysLeft])).toEqual([['c', 1], ['a', 10]]);
});

it('says whether the API client has the Contratos reports yet', () => {
  factory.create.mockReturnValue({});
  expect(contractReportsAvailable()).toBe(false);
  factory.create.mockReturnValue({ listContractReports() {}, getContractReport() {}, exportContractReport() {} });
  expect(contractReportsAvailable()).toBe(true);
  factory.create.mockImplementation(() => { throw new Error('no API URL'); });
  expect(contractReportsAvailable()).toBe(false);
});

it('downloads «Contratos y vigencias» at today\'s cut-off with the filters of the list', async () => {
  const { exportContractsList } = await import('./contractsReportsService');
  const blob = new Blob(['x']);
  const exportContractReport = vi.fn().mockResolvedValue(blob);
  factory.create.mockReturnValue({ exportContractReport });
  const result = await exportContractsList('xlsx', { status: 'Active', airlineId: '' },
    { now: new Date('2026-11-21T15:00:00Z') });
  expect(exportContractReport).toHaveBeenCalledWith('agreements',
    { from: '2026-11-21', to: '2026-11-21', status: 'Active' }, 'xlsx');
  expect(result).toEqual({ blob, fileName: 'elevant-contratos-y-vigencias-2026-11-21.xlsx' });
});
