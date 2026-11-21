import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createPrivateWebApiClient: vi.fn(), readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createPrivateWebApiClient }));
vi.mock('../features/auth/authService', () => ({ readSession: mocks.readSession,
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse }));

import { listHumanResourcesReports } from './humanResourcesVerifiedReportsService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'gh-token' });
});

it('reads the Gestión Humana catalog when the API client has it (ADR-0048)', async () => {
  const catalog = { maxRangeDays: 366, reports: [] };
  mocks.createPrivateWebApiClient.mockReturnValue({ listHumanResourcesReports: vi.fn().mockResolvedValue(catalog) });
  await expect(listHumanResourcesReports()).resolves.toBe(catalog);
});

it('gives null while the API client has no catalog, so the screen keeps its own', async () => {
  mocks.createPrivateWebApiClient.mockReturnValue({});
  await expect(listHumanResourcesReports()).resolves.toBeNull();
});

it('explains a refused catalog without the server title', async () => {
  mocks.createPrivateWebApiClient.mockReturnValue({ listHumanResourcesReports: vi.fn().mockRejectedValue(
    Object.assign(new Error('Forbidden by policy'), { status: 403 })) });
  await expect(listHumanResourcesReports()).rejects.toMatchObject({ status: 403,
    message: 'No tienes acceso a este reporte o estación.' });
});
