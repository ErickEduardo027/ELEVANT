import { afterEach, describe, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import {
  convertLegacyRole, createClientUser, createDepartmentAdministrator, deactivateAccessProfile, setClientUserPortalRole,
  setClientUserStatus, setDepartmentUserStatus, updateDepartmentUser,
} from './departmentGovernanceService';
import { governanceMessage } from './humanResourcesEmployeesService';

vi.mock('./commercialGovernanceApi', () => ({ commercialApi: vi.fn().mockResolvedValue({ id: 'acc-1' }) }));

const key = '82000000-0000-7000-8000-0000000000e1';
const call = index => commercialApi.mock.calls[index];
const problem = (status, code) => Object.assign(new Error('Raw server title'), { status, code });

afterEach(() => vi.clearAllMocks());

// Phase 2, block E (2-N39): the governance commands carry the intent's Idempotency-Key; without one they keep the
// request older clients sent (expand phase).
describe('governance commands', () => {
  it('send the intent key with the body', async () => {
    await createDepartmentAdministrator('contracts', { employeeId: 'emp-1' }, key);
    await updateDepartmentUser('contracts', 'acc-1', { stationIds: ['st-1'], expectedVersion: 'v1' }, key);
    await setDepartmentUserStatus('contracts', 'acc-1', false, 'v1', key);
    await deactivateAccessProfile('contracts', 'prof-1', 'v2', key);
    await createClientUser('org-1', { firstName: 'Ana', lastName: 'Rivera', email: 'ana@demo.test' }, key);
    await setClientUserStatus('org-1', 'acc-2', true, 'v3', key);
    for (let index = 0; index < 6; index += 1) expect(call(index)[1].headers).toEqual({ 'Idempotency-Key': key });
    expect(call(0)[0]).toBe('/governance/departments/contracts/administrators');
    expect(call(1)).toEqual(['/governance/departments/contracts/users/acc-1', expect.objectContaining({ method: 'PUT',
      body: JSON.stringify({ stationIds: ['st-1'], expectedVersion: 'v1' }) })]);
    expect(JSON.parse(call(2)[1].body)).toEqual({ isActive: false, expectedVersion: 'v1' });
    expect(JSON.parse(call(5)[1].body)).toEqual({ isActive: true, expectedVersion: 'v3' });
  });

  it('keeps the request of an older client without a key', async () => {
    await setDepartmentUserStatus('contracts', 'acc-1', true, 'v1');
    expect(call(0)[1]).toEqual({ method: 'POST', body: JSON.stringify({ isActive: true, expectedVersion: 'v1' }) });
  });

  it('designates a portal role and converts a legacy role with the version on screen (2-N20, 2-N19)', async () => {
    await setClientUserPortalRole('org-1', 'acc-2', { representative: true, signer: false, expectedVersion: 'v4' }, key);
    expect(call(0)).toEqual(['/governance/clients/org-1/users/acc-2/portal-role', {
      method: 'POST', body: JSON.stringify({ representative: true, signer: false, expectedVersion: 'v4' }),
      headers: { 'Idempotency-Key': key } }]);
    await convertLegacyRole('role-1', 'stamp-1', key);
    expect(call(1)).toEqual(['/governance/legacy-roles/role-1/convert', {
      method: 'POST', body: JSON.stringify({ expectedVersion: 'stamp-1' }), headers: { 'Idempotency-Key': key } }]);
  });
});

describe('governance messages', () => {
  it('explain the access rules of phase 2 by code and never the server title', () => {
    for (const [code, text] of [['employee_transferred', /se trasladó a otro departamento/],
      ['requester_no_longer_administrator', /ya no administra el departamento/],
      ['stations_outside_employee', /estaciones/i], ['legacy_governance_retired', /se retiró/],
      ['access_request_closed', /ya fue resuelta/]]) {
      const message = governanceMessage(problem(409, code), 'Conflicto de la pantalla.');
      expect(message).toMatch(text);
      expect(message).not.toMatch(/Raw server title/);
    }
  });

  it('let the screen name a stale version and fall back for an unknown conflict', () => {
    expect(governanceMessage(problem(409, 'version_conflict'), 'El usuario cambió mientras lo editaba.'))
      .toBe('El usuario cambió mientras lo editaba.');
    expect(governanceMessage(problem(409, 'governance_conflict'), 'La plantilla cambió.')).toBe('La plantilla cambió.');
    expect(governanceMessage(problem(409, 'version_conflict'))).toMatch(/El expediente cambió/);
    expect(governanceMessage(problem(409))).toMatch(/cambiaron/);
    expect(governanceMessage(problem(403, 'forbidden'))).toBe('No tiene permiso para esta acción.');
    expect(governanceMessage(new Error('No hay conexión con ELEVANT. Intente de nuevo.'))).not.toMatch(/ELEVANT/);
  });
});
