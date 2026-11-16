import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import MapTooltip, { tooltipText } from './MapTooltip';

// Synthetic tooltips in the shape OccMap keeps them, with the size of runway 08/26 of the dataset.
const RUNWAY = { kind: 'runway', id: '08/26', ref: '08/26', lengthM: 3100.1, widthM: 45.1, x: 240, y: 180, alignX: 'start', alignY: 'start', pinned: false };
const TAXIWAY = { kind: 'taxiway', id: 'tw-1', ref: 'A', x: 900, y: 600, alignX: 'end', alignY: 'end', pinned: true };

afterEach(() => {
  cleanup();
  resetLanguageForTests('es');
});

describe('MapTooltip', () => {
  it('renders runway and taxiway content and is not a modal dialog', () => {
    const { rerender } = render(<MapTooltip tooltip={RUNWAY} />);
    const card = screen.getByRole('tooltip');
    expect(card).toHaveTextContent('Pista 08/26 · 3100 m × 45 m');
    expect(card).toHaveAttribute('data-testid', 'map-tooltip');
    // Placed at its point, on the side with room, and it never takes the pointer.
    expect(card).toHaveStyle({ left: '240px', top: '180px', transform: 'translate(12px, 12px)' });
    expect(card).toHaveClass('pointer-events-none', 'absolute', 'bg-occ-panel-float', 'border-occ-line');
    expect(card).toHaveAttribute('data-pinned', 'false');
    // A card, not a dialog: no dialog role, nothing modal, nothing to focus.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card).not.toHaveAttribute('aria-modal');
    expect(card.querySelector('button, a, [tabindex]')).toBeNull();

    // A held taxiway card: its name, a stronger frame, above and to the left of its point.
    rerender(<MapTooltip tooltip={TAXIWAY} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^Calle de rodaje A$/);
    expect(screen.getByRole('tooltip')).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByRole('tooltip')).toHaveClass('border-occ-line-strong');
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(calc(-100% - 12px), calc(-100% - 12px))' });
    rerender(<MapTooltip tooltip={{ ...TAXIWAY, ref: null }} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^Calle de rodaje sin nombre$/);
    // A runway whose size is unknown says only its designator.
    rerender(<MapTooltip tooltip={{ ...RUNWAY, lengthM: null }} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^Pista 08\/26$/);
    // Nothing to show, nothing rendered.
    rerender(<MapTooltip tooltip={null} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    cleanup();

    resetLanguageForTests('en');
    render(<LanguageScope><MapTooltip tooltip={RUNWAY} /></LanguageScope>);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Runway 08/26 · 3100 m × 45 m');
    cleanup();
    render(<LanguageScope><MapTooltip tooltip={{ ...TAXIWAY, ref: null }} /></LanguageScope>);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Unnamed taxiway');
  });

  it('a stand tooltip shows the code, the state, the flight and who covers it', () => {
    // As stands/standInteractions.js writes it: invented flight and agent.
    const STAND = {
      kind: 'stand', id: 'A5', code: 'A5', title: 'A5 · Ocupada', detail: 'DM161 · Cubre M. Castillo',
      reasons: [{ signal: 'attention', text: 'Pasó su hora de salida' }, { signal: null, text: 'Solo fuselaje estrecho' }],
      x: 300, y: 200, alignX: 'start', alignY: 'end', pinned: false,
    };
    render(<MapTooltip tooltip={STAND} />);
    const card = screen.getByRole('tooltip');
    expect(card).toHaveAttribute('data-kind', 'stand');
    expect(within(card).getByText('A5 · Ocupada')).toHaveClass('font-semibold');
    expect(within(card).getByText('DM161 · Cubre M. Castillo')).toHaveClass('text-occ-muted');
    // A signal reads with its shape and its word, never by colour alone; a note has no shape.
    const signal = within(card).getByRole('img', { name: 'Atención' });
    expect(signal).toHaveAttribute('data-shape', 'triangle');
    expect(within(card).getByText('Pasó su hora de salida')).toBeInTheDocument();
    expect(within(card).getByText('Solo fuselaje estrecho').parentElement.querySelector('svg')).toBeNull();
    // It may wrap, inside its card, and never takes the pointer.
    expect(card).toHaveClass('pointer-events-none', 'max-w-xs');
    expect(card).not.toHaveClass('whitespace-nowrap');
    expect(card).toHaveStyle({ left: '300px', top: '200px', transform: 'translate(12px, calc(-100% - 12px))' });
    expect(tooltipText(STAND, key => key)).toEqual({ title: STAND.title, detail: STAND.detail, reasons: STAND.reasons });

    // Nothing but the code and the state for a stand with no flight or agent; the signal's word in English.
    cleanup();
    resetLanguageForTests('en');
    render(<LanguageScope><MapTooltip tooltip={{ ...STAND, title: 'A5 · Free', detail: null, reasons: [{ signal: 'urgent', text: 'Another aircraft is arriving at this stand' }] }} /></LanguageScope>);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^A5 · FreeUrgentAnother aircraft is arriving at this stand$/);
    expect(screen.getByRole('img', { name: 'Urgent' })).toHaveAttribute('data-shape', 'octagon');
  });
  it('the wind tooltip says its words with «No oficial», the time of its METAR and the wind on each runway end', () => {
    // As OccMap writes it from traffic/weatherLayers.js (windTooltip), in the screen's language.
    const WIND = {
      kind: 'wind', id: 'wind', title: 'Viento 100° 13 kt · No oficial', detail: 'METAR de las 10:50',
      reasons: [{ signal: null, text: 'R08: 12 kt de frente · 6 kt de la derecha' },
        { signal: null, text: 'R26: 12 kt de cola · 6 kt de la izquierda' }],
      x: 420, y: 120, alignX: 'end', alignY: 'start', pinned: true,
    };
    render(<MapTooltip tooltip={WIND} />);
    const card = screen.getByRole('tooltip');
    expect(card).toHaveAttribute('data-kind', 'wind');
    expect(card).toHaveAttribute('data-pinned', 'true');
    // Written in lines, as a stand's: the title, the detail muted, a line per runway end without a signal's shape.
    expect(within(card).getByText('Viento 100° 13 kt · No oficial')).toHaveClass('font-semibold');
    expect(within(card).getByText('METAR de las 10:50')).toHaveClass('text-occ-muted');
    expect(within(card).getByText('R26: 12 kt de cola · 6 kt de la izquierda').parentElement.querySelector('svg')).toBeNull();
    expect(card).toHaveClass('pointer-events-none', 'max-w-xs', 'border-occ-line-strong');
    expect(card).toHaveStyle({ left: '420px', top: '120px', transform: 'translate(calc(-100% - 12px), 12px)' });
    expect(tooltipText(WIND, key => key)).toEqual({ title: WIND.title, detail: WIND.detail, reasons: WIND.reasons });
    // A calm wind without lines, its detail stale.
    expect(tooltipText({ kind: 'wind', title: 'Viento en calma · No oficial', detail: 'Sin actualizar desde las 08:00' }, key => key))
      .toEqual({ title: 'Viento en calma · No oficial', detail: 'Sin actualizar desde las 08:00', reasons: [] });
  });
});
