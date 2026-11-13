import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import MapTooltip from './MapTooltip';

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
});
