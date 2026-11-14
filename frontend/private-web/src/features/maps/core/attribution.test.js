import { describe, expect, it } from 'vitest';
import { AIRFIELD_SOURCE, airfieldOverlay } from '../style/airfieldLayers';
import { BASEMAP_SOURCE_ID, buildOccStyle } from '../style/occStyle';
import { OURAIRPORTS_SOURCE, referenceOverlay } from '../style/referenceLayers';
import {
  AIRFIELD_ATTRIBUTION, FIXED_ATTRIBUTION, GIBS_ATTRIBUTION, GIBS_URL, OURAIRPORTS_ATTRIBUTION, buildAttribution,
  collapseCompactAttribution, escapeHtml, httpsUrl,
} from './attribution';

// The attribution as the browser would build it, to read its links and text instead of matching strings.
function parse(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

const links = html => [...parse(html).querySelectorAll('a')]
  .map(anchor => ({ href: anchor.getAttribute('href'), text: anchor.textContent, rel: anchor.getAttribute('rel') }));

// Synthetic sources in the shape of the air picture's `source` (contracts 1.3).
const ADSB = { name: 'adsb.fi', homeUrl: 'https://adsb.fi/', licenseName: 'Uso personal', licenseUrl: 'https://adsb.fi/terms' };

describe('map attribution', () => {
  it('keeps OpenStreetMap, OpenFreeMap and OpenMapTiles fixed', () => {
    const fixed = [
      { href: 'https://www.openstreetmap.org/copyright', text: '© OpenStreetMap contributors', rel: 'noopener noreferrer' },
      { href: 'https://openfreemap.org', text: 'OpenFreeMap', rel: 'noopener noreferrer' },
      { href: 'https://www.openmaptiles.org/', text: '© OpenMapTiles', rel: 'noopener noreferrer' },
    ];
    expect(links(buildAttribution())).toEqual(fixed);
    expect(buildAttribution()).toBe(FIXED_ATTRIBUTION);
    expect(buildAttribution(null)).toBe(FIXED_ATTRIBUTION);
    for (const anchor of parse(FIXED_ATTRIBUTION).querySelectorAll('a')) expect(anchor.getAttribute('target')).toBe('_blank');

    // An active source is added after the fixed part, which stays first and whole.
    const withSource = buildAttribution([ADSB]);
    expect(withSource.startsWith(`${FIXED_ATTRIBUTION} · `)).toBe(true);
    expect(links(withSource).slice(0, 3)).toEqual(fixed);
    expect(parse(withSource).textContent)
      .toBe('© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles · Datos de aeronaves: adsb.fi (Uso personal)');
    expect(links(withSource).slice(3)).toEqual([
      { href: 'https://adsb.fi/', text: 'adsb.fi', rel: 'noopener noreferrer' },
      { href: 'https://adsb.fi/terms', text: 'Uso personal', rel: 'noopener noreferrer' },
    ]);
    expect(parse(buildAttribution([ADSB], { aircraftDataLabel: 'Aircraft data' })).textContent).toContain('Aircraft data: adsb.fi');

    // The vector source names the same text, so MapLibre (which drops a credit contained in another) shows it once.
    expect(buildOccStyle().sources[BASEMAP_SOURCE_ID].attribution).toBe(FIXED_ATTRIBUTION);
    expect(withSource.includes(buildOccStyle().sources[BASEMAP_SOURCE_ID].attribution)).toBe(true);
  });

  it('the airfield credit links OpenStreetMap copyright (ODbL) and OurAirports over https', () => {
    expect(parse(AIRFIELD_ATTRIBUTION).textContent).toBe('© OpenStreetMap contributors (ODbL) · OurAirports');
    expect(links(AIRFIELD_ATTRIBUTION)).toEqual([
      { href: 'https://www.openstreetmap.org/copyright', text: '© OpenStreetMap contributors', rel: 'noopener noreferrer' },
      { href: 'https://opendatacommons.org/licenses/odbl/', text: 'ODbL', rel: 'noopener noreferrer' },
      { href: 'https://ourairports.com/', text: 'OurAirports', rel: 'noopener noreferrer' },
    ]);
    for (const anchor of parse(AIRFIELD_ATTRIBUTION).querySelectorAll('a')) {
      expect(httpsUrl(anchor.getAttribute('href')), anchor.textContent).toBe(anchor.getAttribute('href'));
      expect(anchor.getAttribute('target')).toBe('_blank');
    }
    // It travels on the airfield's own source, so MapLibre lists it only while the airfield is drawn; it is not in the
    // fixed line. MapLibre drops a credit another one contains: neither contains the other, so both show together.
    expect(buildOccStyle({ overlays: [airfieldOverlay()] }).sources[AIRFIELD_SOURCE].attribution).toBe(AIRFIELD_ATTRIBUTION);
    expect(buildAttribution()).not.toContain('OurAirports');
    expect(FIXED_ATTRIBUTION.includes(AIRFIELD_ATTRIBUTION) || AIRFIELD_ATTRIBUTION.includes(FIXED_ATTRIBUTION)).toBe(false);

    // The references drawn from OurAirports (PR M8) credit it on their own source, so it shows while they are drawn,
    // also without the airfield. The airfield credit contains it: with both on screen MapLibre shows it once.
    expect(links(OURAIRPORTS_ATTRIBUTION)).toEqual([{ href: 'https://ourairports.com/', text: 'OurAirports', rel: 'noopener noreferrer' }]);
    expect(parse(OURAIRPORTS_ATTRIBUTION).querySelector('a').getAttribute('target')).toBe('_blank');
    expect(buildOccStyle({ overlays: [referenceOverlay()] }).sources[OURAIRPORTS_SOURCE].attribution).toBe(OURAIRPORTS_ATTRIBUTION);
    expect(AIRFIELD_ATTRIBUTION.includes(OURAIRPORTS_ATTRIBUTION)).toBe(true);
    expect(FIXED_ATTRIBUTION.includes(OURAIRPORTS_ATTRIBUTION)).toBe(false);
  });

  it('each source may bring its own label; NOAA as «Clima»', () => {
    // The aerodrome weather of PR M8, as the API credits it, labelled in the screen's language.
    const NOAA = { name: 'NOAA Aviation Weather Center', homeUrl: 'https://aviationweather.gov', label: 'Clima' };
    const withWeather = buildAttribution([ADSB, NOAA]);
    expect(parse(withWeather).textContent).toBe('© OpenStreetMap contributors · OpenFreeMap · © OpenMapTiles · '
      + 'Datos de aeronaves: adsb.fi (Uso personal) · Clima: NOAA Aviation Weather Center');
    expect(links(withWeather).at(-1)).toEqual({
      href: 'https://aviationweather.gov/', text: 'NOAA Aviation Weather Center', rel: 'noopener noreferrer',
    });
    // Alone, without traffic; in English; a label that comes empty falls back to aircraft data; the label is escaped.
    expect(parse(buildAttribution([NOAA])).textContent).toContain(' · Clima: NOAA Aviation Weather Center');
    expect(parse(buildAttribution([{ ...NOAA, label: 'Weather' }], { aircraftDataLabel: 'Aircraft data' })).textContent)
      .toContain('Weather: NOAA Aviation Weather Center');
    expect(parse(buildAttribution([{ ...ADSB, label: '  ' }])).textContent).toContain('Datos de aeronaves: adsb.fi');
    expect(buildAttribution([{ ...NOAA, label: '<b>Clima</b>' }])).toContain('&lt;b&gt;Clima&lt;/b&gt;: ');

    // The satellite images credit NASA GIBS over https on their own raster sources, apart from the fixed line.
    expect(parse(GIBS_ATTRIBUTION).textContent).toBe('NASA GIBS');
    expect(links(GIBS_ATTRIBUTION)).toEqual([{ href: GIBS_URL, text: 'NASA GIBS', rel: 'noopener noreferrer' }]);
    expect(httpsUrl(GIBS_URL)).toBe(GIBS_URL);
    expect(buildAttribution()).not.toContain('GIBS');
    expect(FIXED_ATTRIBUTION.includes(GIBS_ATTRIBUTION) || GIBS_ATTRIBUTION.includes(FIXED_ATTRIBUTION)).toBe(false);
  });

  it('escapes API-provided text and drops links that are not https', () => {
    const hostile = buildAttribution([
      { name: '<img src=x onerror="alert(1)">', homeUrl: 'javascript:alert(1)' },
      { name: 'Feed "B" & co', homeUrl: 'http://feed.example/', licenseName: '<b>ODbL</b>', licenseUrl: 'data:text/html,hi' },
      { name: 'Relative', homeUrl: '/about' },
      { name: 'Quoted', homeUrl: 'https://feed.example/a"b?x=1&y=2' },
    ]);
    const content = parse(hostile);
    // Nothing from the API becomes markup: the only elements are the links this module writes.
    expect([...content.querySelectorAll('*')].map(element => element.tagName)).toEqual(['A', 'A', 'A', 'A']);
    expect(content.textContent).toContain('Datos de aeronaves: <img src=x onerror="alert(1)">');
    expect(content.textContent).toContain('Datos de aeronaves: Feed "B" & co (<b>ODbL</b>)');
    expect(content.textContent).toContain('Datos de aeronaves: Relative');
    // Only the https home page became a link, with its quote escaped inside the attribute.
    expect(links(hostile).slice(3)).toEqual([
      { href: 'https://feed.example/a%22b?x=1&y=2', text: 'Quoted', rel: 'noopener noreferrer' },
    ]);
    expect(hostile).not.toMatch(/javascript:|data:text|http:\/\/feed/);

    // A source without a name is no credit; the same source twice is credited once.
    expect(buildAttribution([{ name: '  ' }, { homeUrl: 'https://x.example' }, null])).toBe(FIXED_ATTRIBUTION);
    expect(parse(buildAttribution([ADSB, { ...ADSB }])).querySelectorAll('a')).toHaveLength(5);

    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(escapeHtml(null)).toBe('');
    expect(httpsUrl(' https://opendata.adsb.fi ')).toBe('https://opendata.adsb.fi/');
    for (const value of ['http://adsb.fi', 'javascript:alert(1)', 'data:,x', '//adsb.fi', 'adsb.fi', '', null, 42]) {
      expect(httpsUrl(value), String(value)).toBeNull();
    }
  });

  it('closes a compact attribution that MapLibre added open', () => {
    const container = document.createElement('div');
    container.innerHTML = '<details class="maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show" open>'
      + '<summary class="maplibregl-ctrl-attrib-button"></summary></details>';
    expect(collapseCompactAttribution(container)).toBe(true);
    const details = container.querySelector('details');
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.classList.contains('maplibregl-compact-show')).toBe(false);
    expect(details.classList.contains('maplibregl-compact')).toBe(true);
    expect(collapseCompactAttribution(document.createElement('div'))).toBe(false);
    expect(collapseCompactAttribution(null)).toBe(false);
  });
});
