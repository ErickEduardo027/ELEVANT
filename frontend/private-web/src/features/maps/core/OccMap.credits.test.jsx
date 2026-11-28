import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import manifest from '../../../../public/models/aircraft/manifest.json';
import logos from '../../../../public/models/liveries/logos/logos.json';
import { sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { createMapStands } from '../testing/mapFixtures';
import { CREDITS_LINK_CLASS } from './attribution';
import { CREDITS_FILES, resetCreditsForTests } from './credits';
import OccMap from './OccMap';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

// «Créditos y licencias» (PR M5): the link at the end of the map's attribution opens the dialog of the map's credits.
const fake = sharedFakeMapLibre();
const STANDS = createMapStands();

const attributionOf = map => map.controls.find(entry => entry.control instanceof fake.module.AttributionControl)
  ?.control;

// The fake attribution writes its text; MapLibre writes the (sanitized) markup, so the test writes it as MapLibre does.
function creditsLinkOn(map) {
  const control = attributionOf(map);
  const inner = control.element.querySelector('.maplibregl-ctrl-attrib-inner');
  inner.innerHTML = control.options.customAttribution;
  return inner.querySelector(`a.${CREDITS_LINK_CLASS}`);
}

beforeEach(() => {
  fake.state.reset();
  resetCreditsForTests();
  vi.stubGlobal('fetch', vi.fn(url => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(url === CREDITS_FILES.models ? manifest : logos),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetCreditsForTests();
  act(() => resetLanguageForTests('es'));
});

it('ends the attribution with «Créditos y licencias», which opens the dialog on a click and gives the focus back', async () => {
  render(<LanguageScope><div className="relative h-96"><OccMap stands={STANDS} testId="credits-map" /></div></LanguageScope>);
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  expect(attributionOf(map).options.customAttribution).toMatch(/· <a href="#creditos-del-mapa" class="occ-map-credits-link" role="button">Créditos y licencias<\/a>$/);
  const link = creditsLinkOn(map);
  link.focus();

  const click = createEvent.click(link);
  await act(async () => { fireEvent(link, click); });
  // The page never follows the hash.
  expect(click.defaultPrevented).toBe(true);
  const dialog = screen.getByRole('dialog', { name: 'Créditos y licencias' });
  expect(within(dialog).getAllByRole('article')).toHaveLength(22);
  expect(fetch).toHaveBeenCalledTimes(2);
  // The dialog is outside the map: its keys never reach the map's shortcuts, and Esc closes the dialog alone.
  expect(screen.getByTestId('occ-map').contains(dialog)).toBe(false);
  const escape = createEvent.keyDown(dialog, { key: 'Escape' });
  act(() => { fireEvent(dialog, escape); });
  expect(escape.defaultPrevented).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(link);
});

it('opens with Enter or Space on the focused link, as a button, and ignores other keys', async () => {
  render(<LanguageScope><div className="relative h-96"><OccMap stands={STANDS} testId="credits-map" /></div></LanguageScope>);
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  const link = creditsLinkOn(map);
  link.focus();

  const other = createEvent.keyDown(link, { key: 'a' });
  fireEvent(link, other);
  expect(other.defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();

  for (const key of ['Enter', ' ']) {
    const press = createEvent.keyDown(link, { key });
    await act(async () => { fireEvent(link, press); });
    expect(press.defaultPrevented, key).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Créditos y licencias' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  }
  // Read once for every opening.
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('names the link in English on an English screen', () => {
  act(() => resetLanguageForTests('en'));
  render(<LanguageScope><div className="relative h-96"><OccMap stands={STANDS} testId="credits-map" /></div></LanguageScope>);
  const map = fake.state.liveMaps().at(-1);
  act(() => fake.state.emit(map, 'style.load'));
  expect(creditsLinkOn(map).textContent).toBe('Credits and licences');
});
