import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOES_TILE_TEMPLATE, IMERG_TILE_TEMPLATE, imageAgeMinutes, loadGoesImageTime, loadImergImageTime, loadSatelliteImageInfo, satelliteTileAt } from './satelliteService';

afterEach(() => vi.unstubAllGlobals());

describe('NASA GIBS imagery metadata', () => {
  it('uses separate GOES and IMERG layers and the time reported by each tile', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'Layer-Time-Actual': '2026-10-15T16:00:00Z' }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'Layer-Time-Actual': '2026-10-15T12:30:00Z' }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadGoesImageTime()).toBe('2026-10-15T16:00:00Z');
    expect(await loadImergImageTime()).toBe('2026-10-15T12:30:00Z');
    expect(fetchMock.mock.calls[0][0]).toContain('GOES-East_ABI_Band13_Clean_Infrared');
    expect(fetchMock.mock.calls[1][0]).toContain('IMERG_Precipitation_Rate_30min');
    expect(GOES_TILE_TEMPLATE).not.toBe(IMERG_TILE_TEMPLATE);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
  });

  it('does not infer an image time from a missing or invalid header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers() }));
    expect(await loadImergImageTime()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'Layer-Time-Actual': 'invalid' }) }));
    expect(await loadImergImageTime()).toBeNull();
  });

  it('reports tile failures and computes delay from actual image time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, headers: new Headers() }));
    await expect(loadImergImageTime()).rejects.toThrow('satellite-unavailable');
    expect(imageAgeMinutes('2026-10-15T12:30:00Z', Date.parse('2026-10-15T16:00:00Z'))).toBe(210);
    expect(imageAgeMinutes(null)).toBeNull();
  });

  it('keeps day precision for IMERG and pins the displayed tiles to the reported product', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true,
      headers: new Headers({ 'Layer-Time-Actual': '2026-10-15' }) }));
    const info = await loadSatelliteImageInfo('imerg');
    expect(info).toEqual({ time: '2026-10-15', precision: 'day',
      tileTemplate: satelliteTileAt('imerg', '2026-10-15') });
    expect(info.tileTemplate).toContain('/default/2026-10-15/');
    expect(imageAgeMinutes(info.time)).toBeNull();
  });
});
