import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ createOccStand: vi.fn(), updateOccTerminal: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

const { createOccStand, MASTER_DATA_MESSAGES, masterDataMessage, updateOccTerminal } = await import('./occMasterDataService');
const { handleUnauthorizedResponse } = await import('../features/auth/authService');

const failure = (status, code) => Object.assign(new Error('The terminal is in use.'), { status, code, title: 'The terminal is in use.' });
const stationId = '20000000-0000-7000-8000-000000000003';
const terminalId = '20000000-0000-7000-8000-000000000004';
const key = 'a0000000-0000-7000-8000-000000000009';

describe('OCC master data service (2-A)', () => {
  it('explains each refusal by its code and never shows the server title', () => {
    expect(masterDataMessage(failure(409, 'terminal_in_use'))).toBe(MASTER_DATA_MESSAGES.terminal_in_use);
    expect(masterDataMessage(failure(409, 'stand_code_locked'))).toMatch(/su código y su terminal no cambian/);
    expect(masterDataMessage(failure(409, 'aircraft_type_in_use'))).toMatch(/vuelos sin terminar/);
    expect(masterDataMessage(failure(403))).toBe(MASTER_DATA_MESSAGES.forbidden);
    expect(masterDataMessage(failure(409))).toBe('El registro cambió; actualice e intente de nuevo.');
    expect(masterDataMessage(new TypeError('Failed to fetch'))).toMatch(/Revisa la conexión/);
    for (const code of Object.keys(MASTER_DATA_MESSAGES)) expect(masterDataMessage(failure(409, code))).not.toMatch(/The terminal/);
  });

  it('refuses invalid data before sending it and passes valid commands with their key', async () => {
    await expect(createOccStand({ stationId, terminalId, code: 'A 01', hasBoardingBridge: false, isRemote: false }, key))
      .rejects.toMatchObject({ status: 400, code: 'invalid_stand' });
    expect(api.createOccStand).not.toHaveBeenCalled();
    api.updateOccTerminal.mockResolvedValueOnce({ id: terminalId });
    const command = { code: 'A', name: 'Terminal A', isActive: false, expectedVersion: 'AAAAAAAAB9E=' };
    await expect(updateOccTerminal(terminalId, command, key)).resolves.toEqual({ id: terminalId });
    expect(api.updateOccTerminal).toHaveBeenCalledWith(terminalId, command, key);
  });

  it('ends the session on a 401 and rethrows the coded failure', async () => {
    api.updateOccTerminal.mockRejectedValueOnce(failure(401)).mockRejectedValueOnce(failure(409, 'terminal_in_use'));
    const command = { code: 'A', name: 'Terminal A', isActive: false, expectedVersion: 'AAAAAAAAB9E=' };
    await expect(updateOccTerminal(terminalId, command, key)).rejects.toMatchObject({ status: 401 });
    expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    await expect(updateOccTerminal(terminalId, command, key)).rejects.toMatchObject({ code: 'terminal_in_use' });
  });
});
