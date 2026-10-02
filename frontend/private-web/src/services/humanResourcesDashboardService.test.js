import { beforeEach, expect, it, vi } from 'vitest';
import { getHumanResourcesDashboardSnapshot } from './humanResourcesDashboardService';
import { getRampProfiles } from './commercialGovernanceApi';

vi.mock('./commercialGovernanceApi', () => ({ getRampProfiles: vi.fn() }));

beforeEach(() => vi.mocked(getRampProfiles).mockReset());

it('derives active staff and unlinked accounts from the authorized ramp profiles', async () => {
  vi.mocked(getRampProfiles).mockResolvedValue({
    availableStations: [],
    profiles: [
      { id: 'agent-1', firstName: 'Ana', lastName: 'Rivas', employeeNumber: 'DEV-RA-001',
        category: 'Rampa', isActive: true, hasAccount: true, stations: [] },
      { id: 'agent-2', firstName: 'Luis', lastName: 'Vega', employeeNumber: 'DEV-RA-002',
        category: 'Rampa', isActive: true, hasAccount: false, stations: [] },
      { id: 'agent-3', firstName: 'Iris', lastName: 'Cano', employeeNumber: 'DEV-RA-003',
        category: 'Rampa', isActive: false, hasAccount: false, stations: [] },
    ],
  });

  expect(await getHumanResourcesDashboardSnapshot()).toEqual({
    activeStaffTotal: 2,
    pendingAccounts: [{ id: 'agent-2', name: 'Luis Vega', role: 'Rampa' }],
  });
});
