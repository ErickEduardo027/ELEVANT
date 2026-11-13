import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GPUInitializationError, sharedFakeMapLibre } from '../../../../tests/fakeMapLibre';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import OccMap from '../core/OccMap';
import { createMapStands } from '../testing/mapFixtures';
import MapLegend from './MapLegend';

vi.mock('maplibre-gl', async () => (await import('../../../../tests/fakeMapLibre.js')).sharedFakeMapLibre().module);

const fake = sharedFakeMapLibre();
// Synthetic states over the reference points: A1 occupied, A3 planned, B21 disabled and BN6 unverified, the rest free;
// only A1 to A3 were placed by OCC.
const STANDS = createMapStands();
const PAGE = '/admin-occ/positions-map?stationId=s-1';
const RAMP_ORDER = ['available', 'planned', 'occupied', 'disabled', 'unverified'];

const legendItems = () => within(screen.getByRole('list', { name: /Leyenda|Legend/ })).getAllByRole('listitem')
  .map(item => item.textContent);

beforeEach(() => {
  fake.state.reset();
  window.history.replaceState({}, '', PAGE);
});

afterEach(() => {
  cleanup();
  resetLanguageForTests('es');
  window.history.replaceState({}, '', '/');
});

describe('MapLegend', () => {
  it('shows the Spanish and English labels from statusVocabulary and folds through its own button', () => {
    const { unmount } = render(<MapLegend stands={STANDS} />);
    const legend = screen.getByTestId('map-legend');
    // The words of the vocabulary, in its order, and the «No oficial» plate with what it means.
    expect(legendItems()).toEqual([
      ...RAMP_ORDER.map(state => STAND_STATES[state].es),
      `${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`,
    ]);
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar']);
    // Each state is drawn as the map draws it: its outline token and its dash.
    const swatches = [...legend.querySelectorAll('li svg rect')];
    expect(swatches.map(rect => rect.style.stroke)).toEqual([
      'var(--occ-line-strong)', 'var(--occ-muted)', 'var(--occ-text)', 'var(--occ-line-strong)', 'var(--occ-faint)',
    ]);
    expect(swatches.map(rect => rect.style.strokeDasharray)).toEqual(['none', '4 3', 'none', '2 2', '1 3']);
    expect(swatches[2].style.fill).toBe('var(--occ-panel-raised)');
    expect(legend.querySelectorAll('li path')).toHaveLength(1);

    // One button folds it; its name stays «Leyenda» and aria-expanded says whether it is open.
    const toggle = within(legend).getByRole('button', { name: 'Leyenda' });
    const list = screen.getByRole('list', { name: 'Leyenda' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', list.parentElement.id);
    expect(toggle).toHaveAttribute('title', 'Ocultar leyenda');
    expect(toggle).toHaveClass('min-h-11');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('title', 'Mostrar leyenda');
    expect(list).not.toBeVisible();
    fireEvent.click(toggle);
    expect(list).toBeVisible();
    unmount();

    // English, from the same vocabulary; it can start folded.
    resetLanguageForTests('en');
    render(<LanguageScope><MapLegend stands={STANDS} defaultOpen={false} /></LanguageScope>);
    const english = screen.getByRole('button', { name: 'Legend' });
    expect(english).toHaveAttribute('aria-expanded', 'false');
    expect(english).toHaveAttribute('title', 'Show legend');
    fireEvent.click(english);
    expect(legendItems()).toEqual([
      ...RAMP_ORDER.map(state => STAND_STATES[state].en),
      `${TAGS.unofficial.en}Internal reference location, not verified`,
    ]);
    expect(legendItems().at(0)).toBe('Free');
  });

  it('lists only the stands on the screen of its map', () => {
    window.history.replaceState({}, '', `${PAGE}&view=ramp&terminal=FBO`);
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    // The FBO view: free stands and BN6 without a database row, all at their reference location.
    expect(legendItems()).toEqual(['Libre', 'Sin verificar', `${TAGS.unofficial.es}Ubicación de referencia interna, sin verificar`]);

    fireEvent.keyDown(map.getCanvas(), { key: '4' });
    expect(legendItems().slice(0, 5)).toEqual(['Libre', 'Planificada', 'Ocupada', 'Inhabilitada', 'Sin verificar']);

    // Up close on A1 to A3, the stands OCC placed: their states and no «No oficial».
    act(() => map.jumpTo({ center: [-68.360889, 18.56418], zoom: 19.4 }));
    expect(legendItems()).toEqual(['Libre', 'Planificada', 'Ocupada']);
  });

  it('renders nothing when no stand is on screen', async () => {
    // Nothing to explain: no stands, or none with a place on the map.
    const { rerender } = render(<MapLegend stands={[]} />);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    rerender(<MapLegend stands={[{ id: 'X1', latitude: null, longitude: null, status: 'planned' }]} />);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    // Stands outside the bounds the caller gives are not on screen either.
    rerender(<MapLegend stands={STANDS} bounds={[[-70.6, 19.4], [-70.5, 19.5]]} />);
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    cleanup();

    // Inside a map: the legend goes when the camera leaves the stands and comes back with them.
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    const map = fake.state.liveMaps().at(-1);
    act(() => fake.state.emit(map, 'style.load'));
    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
    act(() => map.jumpTo({ center: [-70.55, 19.45], zoom: 14 }));
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
    act(() => map.jumpTo({ center: [-68.3634, 18.5674], zoom: 15 }));
    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
    cleanup();

    // A map that cannot draw has nothing on screen: its fallback list stands in for the legend.
    fake.state.reset({ constructorError: new GPUInitializationError() });
    render(
      <OccMap stands={STANDS}>
        <MapLegend />
      </OccMap>,
    );
    expect(await screen.findByTestId('map-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument();
  });
});
