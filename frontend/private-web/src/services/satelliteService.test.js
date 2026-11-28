import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOES_TILE_TEMPLATE, IMERG_TILE_TEMPLATE, MAX_DOMAIN_INSTANTS, gibsDomainUrl, imageAgeMinutes, loadGibsDomain,
  loadGibsLatestTime, loadGoesImageTime, loadImergImageTime, loadSatelliteImageInfo, parseGibsDomain, satelliteTileAt,
} from './satelliteService';

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

// Hotfix of 2026-11-28: which images GIBS has of a band of the satellite loop, from its DescribeDomains.
const domainXml = text => '<?xml version="1.0" encoding="UTF-8"?><Domains xmlns:ows="http://www.opengis.net/ows/1.1">'
  + '<SpaceDomain><BoundingBox crs="urn:ogc:def:crs:EPSG::3857">-1 -1 1 1</BoundingBox></SpaceDomain>'
  + `<DimensionDomain><ows:Identifier>time</ows:Identifier><ows:UOM>ISO8601</ows:UOM><Domain>${text}</Domain>`
  + '</DimensionDomain></Domains>';
// The domains GIBS answered on 2026-11-28 at 17:20 UTC for the window 12:00–18:00.
const GEOCOLOR_28 = '2026-11-28T12:00:00Z/2026-11-28T15:50:00Z/PT10M,2026-11-28T16:10:00Z/2026-11-28T16:20:00Z/PT10M';
const IR_28 = '2026-11-28T12:00:00Z/2026-11-28T16:50:00Z/PT10M';
const WINDOW = { fromMs: Date.parse('2026-11-28T14:20:00Z'), toMs: Date.parse('2026-11-28T17:20:00Z') };

describe('NASA GIBS DescribeDomains of the satellite loop', () => {
  it('expands periods and single instants into sorted, unique GIBS instants, holes and all', () => {
    const geocolor = parseGibsDomain(domainXml(GEOCOLOR_28));
    expect(geocolor).toHaveLength(26);
    expect(geocolor.slice(-7)).toEqual(['2026-11-28T15:10:00Z', '2026-11-28T15:20:00Z', '2026-11-28T15:30:00Z',
      '2026-11-28T15:40:00Z', '2026-11-28T15:50:00Z', '2026-11-28T16:10:00Z', '2026-11-28T16:20:00Z']);
    expect(geocolor).not.toContain('2026-11-28T16:00:00Z');
    expect(parseGibsDomain(domainXml(IR_28)).at(-1)).toBe('2026-11-28T16:50:00Z');
    // Single instants, out of order and repeated, with a period that overlaps them.
    expect(parseGibsDomain(domainXml(
      '2026-11-28T16:20:00Z, 2026-11-28T15:00:00Z,2026-11-28T15:00:00Z/2026-11-28T15:20:00Z/PT10M',
    ))).toEqual(['2026-11-28T15:00:00Z', '2026-11-28T15:10:00Z', '2026-11-28T15:20:00Z', '2026-11-28T16:20:00Z']);
    // Hours and minutes in the period; a prefixed element.
    expect(parseGibsDomain('<ows:Domain>2026-11-28T12:00:00Z/2026-11-28T14:00:00Z/PT1H</ows:Domain>'))
      .toEqual(['2026-11-28T12:00:00Z', '2026-11-28T13:00:00Z', '2026-11-28T14:00:00Z']);
  });

  it('keeps the window and the cap, the latest instants first to stay', () => {
    expect(parseGibsDomain(domainXml(GEOCOLOR_28), WINDOW)).toEqual(['2026-11-28T14:20:00Z', '2026-11-28T14:30:00Z',
      '2026-11-28T14:40:00Z', '2026-11-28T14:50:00Z', '2026-11-28T15:00:00Z', '2026-11-28T15:10:00Z',
      '2026-11-28T15:20:00Z', '2026-11-28T15:30:00Z', '2026-11-28T15:40:00Z', '2026-11-28T15:50:00Z',
      '2026-11-28T16:10:00Z', '2026-11-28T16:20:00Z']);
    expect(parseGibsDomain(domainXml(IR_28), { max: 2 })).toEqual(['2026-11-28T16:40:00Z', '2026-11-28T16:50:00Z']);
    // A period that began years before the window walks only the window's steps.
    expect(parseGibsDomain(domainXml('2020-01-01T00:00:00Z/2026-11-28T16:50:00Z/PT10M'), WINDOW)).toHaveLength(16);
    const unbounded = parseGibsDomain(domainXml('2020-01-01T00:00:00Z/2026-11-28T16:50:00Z/PT10M'));
    expect(unbounded).toHaveLength(MAX_DOMAIN_INSTANTS);
    expect(unbounded.at(-1)).toBe('2026-11-28T16:50:00Z');
  });

  it('answers no instants for an empty domain and unknown (null) for anything malformed, never an exception', () => {
    expect(parseGibsDomain(domainXml(''))).toEqual([]);
    expect(parseGibsDomain(domainXml('  '))).toEqual([]);
    expect(parseGibsDomain(domainXml(IR_28), { fromMs: Date.parse('2026-11-29T00:00:00Z') })).toEqual([]);
    for (const text of ['2026-11-28T16:50Z', '2026-11-28', 'ayer', '2026-11-28T12:00:00Z/2026-11-28T16:50:00Z',
      '2026-11-28T12:00:00Z/2026-11-28T16:50:00Z/P1D', '2026-11-28T12:00:00Z/2026-11-28T16:50:00Z/PT0M',
      '2026-11-28T12:00:00Z/2026-11-28T16:50:00Z/PT30S', '2026-11-28T16:50:00Z/2026-11-28T12:00:00Z/PT10M',
      `${IR_28},`, '2026-11-28T12:00:00Z/2026-11-28T16:50:00Z/PT10M/x']) {
      expect(parseGibsDomain(domainXml(text)), text).toBeNull();
    }
    expect(parseGibsDomain('<Domains><DimensionDomain></DimensionDomain></Domains>')).toBeNull();
    expect(parseGibsDomain('<html>Bad gateway</html>')).toBeNull();
    expect(parseGibsDomain(null)).toBeNull();
    expect(parseGibsDomain(42)).toBeNull();
  });

  it('reads the domain of a layer over a window of whole minutes, with the timeout and the cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(domainXml(GEOCOLOR_28), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const times = await loadGibsDomain({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7',
      fromMs: WINDOW.fromMs - 30_500, toMs: WINDOW.toMs - 30_500, signal: controller.signal });
    expect(times.at(-1)).toBe('2026-11-28T16:20:00Z');
    expect(fetchMock.mock.calls[0][0]).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/'
      + 'GOES-East_ABI_GeoColor/default/GoogleMapsCompatible_Level7/all/2026-11-28T14:20:00Z--2026-11-28T17:20:00Z.xml');
    const init = fetchMock.mock.calls[0][1];
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    expect(init.signal.aborted).toBe(false);
    controller.abort();
    expect(init.signal.aborted).toBe(true);
    // A failed answer throws; an unreadable one is unknown.
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(loadGibsDomain({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7', ...WINDOW }))
      .rejects.toThrow('satellite-unavailable');
    fetchMock.mockResolvedValueOnce(new Response('<Domain>mañana</Domain>', { status: 200 }));
    await expect(loadGibsDomain({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7', ...WINDOW }))
      .resolves.toBeNull();
    // Only GIBS names and a valid window reach the network.
    await expect(loadGibsDomain({ layer: '../x', matrix: 'GoogleMapsCompatible_Level7', ...WINDOW }))
      .rejects.toThrow('unknown-satellite-layer');
    await expect(loadGibsDomain({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7',
      fromMs: WINDOW.toMs, toMs: WINDOW.fromMs })).rejects.toThrow('invalid-satellite-window');
    expect(gibsDomainUrl('GOES-East_ABI_Band13_Clean_Infrared', 'GoogleMapsCompatible_Level6', WINDOW.fromMs,
      WINDOW.toMs)).toContain('/GOES-East_ABI_Band13_Clean_Infrared/default/GoogleMapsCompatible_Level6/all/');
  });

  it('reads the latest time of a band from its own header over PUJ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true,
      headers: new Headers({ 'Layer-Time-Actual': '2026-11-28T16:20:00Z' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadGibsLatestTime({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7' }))
      .resolves.toBe('2026-11-28T16:20:00Z');
    expect(fetchMock.mock.calls[0][0]).toBe('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
      + 'GOES-East_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/6/28/19.png');
    fetchMock.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'Layer-Time-Actual': '2026-11-28' }) });
    await expect(loadGibsLatestTime({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7' }))
      .resolves.toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: false, headers: new Headers() });
    await expect(loadGibsLatestTime({ layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7' }))
      .rejects.toThrow('satellite-unavailable');
  });
});
