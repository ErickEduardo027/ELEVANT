import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getOccMobileDevices: vi.fn(), unbindOccMobileDevice: vi.fn(), revokeOccMobileDevice: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

const { loadOccDevices, revokeOccDevice, unbindOccDevice } = await import('./occDevicesService');
const { DEVICE_PROBLEM_MESSAGES, deviceProblemMessage } = await import('./deviceProblemMessages');
const { handleUnauthorizedResponse } = await import('../features/auth/authService');

const failure = (status, code) => Object.assign(new Error('Raw server title'), { status, code, title: 'Raw server title' });
const deviceId = '81000000-0000-7000-8000-0000000000d1';
const stationId = '20000000-0000-7000-8000-000000000003';
const key = 'a0000000-0000-7000-8000-0000000000d2';

// Phase 2, block E (2-N02): OCC's shared tablets.
describe('OCC tablets service', () => {
  it('explains each refusal by its code and never shows the server title', () => {
    expect(deviceProblemMessage(failure(409, 'device_not_bound'))).toBe(DEVICE_PROBLEM_MESSAGES.device_not_bound);
    expect(deviceProblemMessage(failure(409, 'device_revoked'))).toMatch(/ya no puede vincularse/);
    expect(deviceProblemMessage(failure(409, 'version_conflict'))).toMatch(/cambió de manos/);
    expect(deviceProblemMessage(failure(403))).toBe(DEVICE_PROBLEM_MESSAGES.forbidden);
    expect(deviceProblemMessage(new TypeError('Failed to fetch'))).toMatch(/Revisa la conexión/);
    for (const code of Object.keys(DEVICE_PROBLEM_MESSAGES))
      expect(deviceProblemMessage(failure(409, code))).not.toMatch(/Raw server title/);
  });

  it('refuses a revocation without a reason before sending it and passes the commands with their key', async () => {
    await expect(revokeOccDevice(deviceId, { expectedVersion: 'tok-1', reason: 'no' }, key))
      .rejects.toMatchObject({ status: 400, code: 'reason_required' });
    expect(api.revokeOccMobileDevice).not.toHaveBeenCalled();
    api.revokeOccMobileDevice.mockResolvedValueOnce({ id: deviceId, status: 'Revoked' });
    await revokeOccDevice(deviceId, { expectedVersion: 'tok-1', reason: 'Tablet extraviada' }, key);
    expect(api.revokeOccMobileDevice).toHaveBeenCalledWith(deviceId,
      { expectedVersion: 'tok-1', reason: 'Tablet extraviada' }, key);
    api.unbindOccMobileDevice.mockResolvedValueOnce({ id: deviceId, status: 'Unbound' });
    await unbindOccDevice(deviceId, { expectedVersion: 'tok-2', reason: null }, key);
    expect(api.unbindOccMobileDevice).toHaveBeenCalledWith(deviceId, { expectedVersion: 'tok-2', reason: null }, key);
  });

  it('reads the tablets of the station and signs out an expired session', async () => {
    api.getOccMobileDevices.mockResolvedValueOnce({ stationId, devices: [] });
    await expect(loadOccDevices(stationId)).resolves.toEqual({ stationId, devices: [] });
    api.getOccMobileDevices.mockRejectedValueOnce(failure(401));
    await expect(loadOccDevices(stationId)).rejects.toMatchObject({ status: 401 });
    expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
  });
});
