import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../../../public/models/aircraft/manifest.json';
import logos from '../../../../public/models/liveries/logos/logos.json';
import { LOGO_IATA } from '../aircraft/liveries';
import { AIRFIELD_ATTRIBUTION, FIXED_ATTRIBUTION, GIBS_ATTRIBUTION, OURAIRPORTS_ATTRIBUTION } from './attribution';
import {
  CREDITS_FILES, DATA_CREDITS, LOGO_AIRLINES, MODEL_NOTICES, loadCredits, logoCredits, modelCredits, resetCreditsForTests,
} from './credits';

afterEach(() => resetCreditsForTests());

const ok = body => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const hrefsOf = html => [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]);

describe('map credits (PR M5)', () => {
  it('lists every vendored model with its base, authors, pinned source, upstream, licence and changes', () => {
    const models = modelCredits(manifest);
    expect(models.map(model => model.icao)).toEqual(Object.keys(manifest.types).sort());
    expect(models).toHaveLength(22);
    // B763 stays procedural: it has no model and no credit.
    expect(models.some(model => model.icao === 'B763')).toBe(false);

    const b738 = models.find(model => model.icao === 'B738');
    expect(b738).toMatchObject({
      name: 'Boeing 737-800', baseName: 'Boeing 737-800', proxy: false, licence: 'GPL-2.0-only',
      repository: 'mbr1376/fr24-3d-models', repositoryUrl: 'https://github.com/mbr1376/fr24-3d-models',
      upstream: 'FGMEMBERS/737-800', upstreamUrl: 'https://github.com/FGMEMBERS/737-800', changeDate: '2026-11-27',
    });
    expect(b738.authors).toContain('Aleksei Kalmykov');
    expect(b738.authors).toContain('mbr1376');
    expect(b738.sourceUrl).toMatch(/^https:\/\/github\.com\/mbr1376\/fr24-3d-models\/blob\/3d0a50d[0-9a-f]+\/models\/gltf_v2\/airplane\/b738\.glb$/);
    expect(b738.changes.length).toBeGreaterThan(3);
    expect(b738.notices).toEqual(MODEL_NOTICES.map(file => ({ file, href: `/models/aircraft/B738/${file}` })));

    // A sibling is said to be adjusted from its base; the licences kept apart stay apart.
    const b38m = models.find(model => model.icao === 'B38M');
    expect([b38m.proxy, b38m.baseName]).toEqual([true, 'Boeing 737 MAX 9']);
    expect(b38m.authors).toContain('Original model by omri_ha_muglob');
    expect(models.find(model => model.icao === 'AT76')).toMatchObject({ licence: 'GPL-3.0-only', upstreamUrl: null });
    expect(models.find(model => model.icao === 'CRJ9').licence).toBe('GPL-2.0-or-later');
    expect(models.find(model => model.icao === 'B77W').note).toContain('GPLv2');
    expect(models.find(model => model.icao === 'A320').authors).toContain('Ysurac');
  });

  it('keeps only https links and ICAO codes from the files it reads', () => {
    const models = modelCredits({
      changeDate: '2026-11-27',
      types: {
        '../X': { name: 'Bad' },
        A320: {
          name: 'Airbus A320', licence: 'GPL-2.0-only', files: { notices: ['LICENSE', '../../secret', 'NOTICE.md'] },
          credit: { repositoryUrl: 'javascript:alert(1)', sourceUrl: 'http://example.com/a.glb', upstreamUrl: 'https://github.com/FGMEMBERS/A320-family' },
        },
      },
    });
    expect(models.map(model => model.icao)).toEqual(['A320']);
    expect(models[0]).toMatchObject({ repositoryUrl: null, sourceUrl: null, upstreamUrl: 'https://github.com/FGMEMBERS/A320-family' });
    expect(models[0].notices.map(notice => notice.file)).toEqual(['LICENSE', 'NOTICE.md']);
    expect([modelCredits(null), modelCredits({}), logoCredits(undefined)]).toEqual([[], [], []]);
    expect(logoCredits({ logos: { AA: { page: 'data:text/html,x', tag: 'PD-textlogo' }, 'a/b': {} } }))
      .toEqual([{ iata: 'AA', airline: 'American Airlines', page: null, tag: 'PD-textlogo', trademarked: false }]);
    // An airline without a full name keeps the liveries' word.
    expect(logoCredits({ logos: { CM: {} } })[0].airline).toBe('COPA');
  });

  it('lists the public-domain text logos with their Commons page, tag and trademark mark', () => {
    const credits = logoCredits(logos);
    expect(credits.map(logo => logo.iata)).toEqual([...LOGO_IATA].sort());
    for (const logo of credits) {
      expect(logo.page, logo.iata).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(['PD-textlogo', 'PD-shape'], logo.iata).toContain(logo.tag);
      expect(logo.trademarked, logo.iata).toBe(true);
      expect(logo.airline, logo.iata).not.toBe(logo.iata);
    }
    expect(Object.keys(LOGO_AIRLINES).sort()).toEqual([...LOGO_IATA].sort());
    expect(credits.find(logo => logo.iata === 'DL').airline).toBe('Delta Air Lines');
  });

  it('credits the same data and tiles as the attribution line, over https', () => {
    const credited = DATA_CREDITS.flatMap(entry => entry.links.map(link => link.href));
    for (const html of [FIXED_ATTRIBUTION, AIRFIELD_ATTRIBUTION, OURAIRPORTS_ATTRIBUTION, GIBS_ATTRIBUTION]) {
      for (const href of hrefsOf(html)) expect(credited, href).toContain(href);
    }
    expect(DATA_CREDITS.map(entry => entry.key)).toEqual(['basemap', 'airfield', 'references', 'satellite', 'weather', 'font']);
    for (const href of credited) expect(href, href).toMatch(/^https:\/\//);
  });

  it('reads both files once, from the own origin, and again only after a failure', async () => {
    const fetchImpl = vi.fn(url => ok(url === CREDITS_FILES.models ? manifest : logos));
    const first = await loadCredits(fetchImpl);
    const second = await loadCredits(fetchImpl);
    expect(second).toBe(first);
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init.credentials])).toEqual([
      ['/models/aircraft/manifest.json', 'same-origin'], ['/models/liveries/logos/logos.json', 'same-origin'],
    ]);
    expect(first.models).toHaveLength(22);
    expect(first.logos).toHaveLength(LOGO_IATA.length);

    resetCreditsForTests();
    const failing = vi.fn(() => Promise.resolve({ ok: false, status: 503 }));
    await expect(loadCredits(failing)).rejects.toThrow(/503/);
    const retried = await loadCredits(fetchImpl);
    expect(retried.models).toHaveLength(22);
  });
});
