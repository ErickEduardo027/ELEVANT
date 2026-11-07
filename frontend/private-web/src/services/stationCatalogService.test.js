import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ createGovernanceStation: vi.fn(), updateGovernanceStation: vi.fn(), listGovernanceStations: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

const { createStation, STATION_MESSAGES, stationMessage, updateStation } = await import('./stationCatalogService');

const failure = (status, code) => Object.assign(new Error('The station code is taken.'), { status, code, title: 'The station code is taken.' });
const key = 'a0000000-0000-7000-8000-000000000009';

describe('station catalog service (2-A)', () => {
  it('explains each station refusal by its code', () => {
    expect(stationMessage(failure(409, 'station_code_taken'))).toBe('Ya existe una estación con ese código.');
    expect(stationMessage(failure(409, 'time_zone_locked'))).toMatch(/su zona horaria no cambia/);
    // A scheduled shift or an open coverage keeps a station in use as much as a contract or a flight.
    expect(stationMessage(failure(409, 'station_in_use'))).toMatch(/turnos programados o coberturas abiertas: no se puede desactivar/);
    expect(stationMessage(failure(400, 'airport_required'))).toMatch(/código OACI/);
    expect(stationMessage(failure(403))).toBe(STATION_MESSAGES.forbidden);
    expect(stationMessage(new TypeError('Failed to fetch'))).toMatch(/Revise la conexión/);
    for (const code of Object.keys(STATION_MESSAGES)) expect(stationMessage(failure(409, code))).not.toMatch(/station code/);
  });

  it('refuses an invalid station before sending it and sends a valid one with its key', async () => {
    await expect(createStation({ code: 'PUNTA', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' }, key))
      .rejects.toMatchObject({ status: 400, code: 'invalid_station' });
    await expect(updateStation('st-1', { name: 'P', ianaTimeZone: 'America/Santo_Domingo', isActive: true, expectedVersion: 'v' }, key))
      .rejects.toMatchObject({ status: 400, code: 'invalid_station' });
    expect(api.createGovernanceStation).not.toHaveBeenCalled();
    expect(api.updateGovernanceStation).not.toHaveBeenCalled();
    api.createGovernanceStation.mockResolvedValueOnce({ code: 'MIA' });
    const input = { code: 'MIA', name: 'AVIAM Miami', ianaTimeZone: 'America/New_York' };
    await expect(createStation(input, key)).resolves.toEqual({ code: 'MIA' });
    expect(api.createGovernanceStation).toHaveBeenCalledWith(input, key);
  });
});
