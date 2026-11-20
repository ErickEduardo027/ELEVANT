import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { createTranslator, resetLanguageForTests } from '../../i18n/languageStore';
import OccFlightStrip, { flightStripName, OCC_FLIGHT_STRIP_LAYOUT, OCC_FLIGHT_STRIP_PARTS } from './OccFlightStrip';
import { occUiMessages } from './occUiMessages';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

// Punta Cana is UTC−4: 18:32 UTC is 14:32 at the station.
const ZONE = 'America/Santo_Domingo';
const NOW = Date.parse('2026-11-14T18:32:00Z');

const DEMO_ARRIVAL = Object.freeze({
  id: 'p:demo-1', direction: 'Arrival', flightNumber: 'ZZ9001', counterpartIata: 'MIA',
  time: { at: '2026-11-14T18:44:00Z', kind: 'estimated' }, standCode: 'A7',
  status: { label: 'En aproximación', signal: null }, demo: true, estimated: false,
});
const DEPARTURE = Object.freeze({
  id: 'l:aa905', direction: 'Departure', flightNumber: 'AA905', counterpartIata: 'MIA',
  time: { at: '2026-11-14T19:35:00Z', kind: 'scheduled' }, standCode: 'A5',
  status: { label: 'Programado', signal: null }, demo: false, estimated: false,
});
const WITHOUT_STAND = Object.freeze({
  id: 'p:dm161', direction: 'Arrival', flightNumber: 'DM161', counterpartIata: 'SDQ',
  time: { at: '2026-11-14T18:55:00Z', kind: 'estimated' }, standCode: null,
  status: { label: 'Llegada sin posición asignada', signal: 'attention' }, demo: false, estimated: true,
});

const DEMO_NAME = 'Llegada, 14:44 estimada, ZZ9001, Demo, desde MIA, posición A7, En aproximación, en 12 min';
const classesOf = element => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const stripOf = flight => document.querySelector(`[data-occ-flight-strip="${flight.id}"]`);
const partOf = (strip, part) => [...strip.children].find(child => child.dataset.part === part);

function strip(props) {
  return <OccFlightStrip flight={DEMO_ARRIVAL} now={NOW} timeZone={ZONE} {...props} />;
}

describe('OccFlightStrip', () => {
  it('keeps the fixed field order of a flight progress strip', () => {
    expect(OCC_FLIGHT_STRIP_PARTS).toEqual(['direction', 'time', 'flight', 'tags', 'counterpart', 'stand', 'status', 'countdown']);
    render(<>{strip()}<OccFlightStrip flight={WITHOUT_STAND} timeZone={ZONE} /></>);
    for (const flight of [DEMO_ARRIVAL, WITHOUT_STAND]) {
      // Every cell is there, in its place, even an empty one, so stacked strips line up field by field.
      expect([...stripOf(flight).children].map(child => child.dataset.part), flight.id).toEqual(OCC_FLIGHT_STRIP_PARTS);
    }
    const demo = stripOf(DEMO_ARRIVAL);
    expect(partOf(demo, 'direction')).toHaveTextContent('Llegada');
    expect(partOf(demo, 'direction').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(partOf(demo, 'time')).getByText('14:44').tagName).toBe('TIME');
    expect(within(partOf(demo, 'time')).getByText('14:44')).toHaveAttribute('dateTime', '2026-11-14T18:44:00.000Z');
    expect(within(partOf(demo, 'flight')).getByText('ZZ9001')).toHaveAttribute('data-occ-plate', 'flight');
    expect(within(partOf(demo, 'tags')).getByText('Demo')).toHaveAttribute('data-occ-tag', 'demo');
    expect(within(partOf(demo, 'counterpart')).getByText('MIA')).toHaveAttribute('data-occ-plate', 'code');
    expect(within(partOf(demo, 'stand')).getByText('A7')).toHaveAttribute('data-occ-plate', 'stand');
    expect(partOf(demo, 'status')).toHaveTextContent('En aproximación');
    expect(partOf(demo, 'countdown')).toHaveTextContent('en 12 min');
    // Two lines on fixed columns: the glyph spans both, the status and the countdown sit on the second.
    expect(OCC_FLIGHT_STRIP_LAYOUT.grid).toMatch(/grid-cols-\[1rem_4\.75rem_4\.5rem_minmax\(0,1fr\)_2\.75rem_5rem\]/);
    expect(classesOf(partOf(demo, 'direction'))).toContain('row-span-2');
    expect(classesOf(partOf(demo, 'status'))).toEqual(expect.arrayContaining(['col-start-2', 'col-end-5']));
    expect(classesOf(partOf(demo, 'countdown'))).toEqual(expect.arrayContaining(['col-start-5', 'col-end-7', 'text-right']));
    // Identifiers are plates in mono, the clock in mono; nothing else is.
    expect(within(partOf(demo, 'time')).getByText('14:44')).toHaveClass('font-mono');
    expect(partOf(demo, 'status')).not.toHaveClass('font-mono');
  });

  it('names the strip in full words for assistive technology', () => {
    const onSelect = vi.fn();
    render(
      <>
        {strip({ onSelect })}
        <OccFlightStrip flight={DEPARTURE} onSelect={onSelect} now={NOW} timeZone={ZONE} />
        <OccFlightStrip flight={WITHOUT_STAND} onSelect={onSelect} now={NOW} timeZone={ZONE} />
      </>,
    );
    expect(screen.getByRole('button', { name: DEMO_NAME })).toBe(stripOf(DEMO_ARRIVAL));
    expect(screen.getByRole('button', {
      name: 'Salida, 15:35 programada, AA905, hacia MIA, posición A5, Programado, en 1 h 3 min',
    })).toBe(stripOf(DEPARTURE));
    expect(screen.getByRole('button', {
      name: 'Llegada, 14:55 estimada, DM161, posición estimada, desde SDQ, Sin posición, '
        + 'Atención: Llegada sin posición asignada, en 23 min',
    })).toBe(stripOf(WITHOUT_STAND));
    // The abbreviation «est.» is seen; the word «estimada» is heard.
    const time = partOf(stripOf(DEMO_ARRIVAL), 'time');
    expect(within(time).getByText('est.')).toHaveAttribute('aria-hidden', 'true');
    expect(within(time).getByText('estimada')).toHaveClass('sr-only');

    // The same words without a screen: the board model can name a row for a list or a toast.
    const t = createTranslator(occUiMessages, 'es');
    expect(flightStripName(DEMO_ARRIVAL, { t, language: 'es', locale: 'es-DO', timeZone: ZONE, now: NOW })).toBe(DEMO_NAME);
    expect(flightStripName(DEMO_ARRIVAL, { t, language: 'es', locale: 'es-DO', timeZone: ZONE }))
      .toBe('Llegada, 14:44 estimada, ZZ9001, Demo, desde MIA, posición A7, En aproximación');
    expect(flightStripName({ ...DEPARTURE, time: null, counterpartIata: null, status: null }, { t, timeZone: ZONE, now: NOW }))
      .toBe('Salida, Sin hora, AA905, posición A5');
  });

  it('shows «Demo» and «est.» with their textures and «Sin posición» without a stand', () => {
    render(<>{strip()}<OccFlightStrip flight={WITHOUT_STAND} now={NOW} timeZone={ZONE} /></>);
    const demoTags = partOf(stripOf(DEMO_ARRIVAL), 'tags');
    // Demo: the word on 45° stripes; est. absent where the position is measured.
    expect(within(demoTags).getByText('Demo').querySelector('pattern')).toHaveAttribute('patternTransform', 'rotate(45)');
    expect(demoTags.querySelector('[data-occ-tag="estimated"]')).toBeNull();
    const estimatedTags = partOf(stripOf(WITHOUT_STAND), 'tags');
    const estimated = within(estimatedTags).getByText('est.');
    expect(estimated).toHaveAttribute('data-occ-tag', 'estimated');
    expect(estimated).toHaveClass('border-dashed');
    expect(estimatedTags.querySelector('[data-occ-tag="demo"]')).toBeNull();
    // Without a stand: the words, muted, and no plate.
    const stand = partOf(stripOf(WITHOUT_STAND), 'stand');
    expect(within(stand).getByText('Sin posición')).toHaveClass('text-occ-muted');
    expect(stand.querySelector('[data-occ-plate]')).toBeNull();
    // Both tags at once, as a demo aircraft without a live signal has them.
    cleanup();
    render(<OccFlightStrip flight={{ ...DEMO_ARRIVAL, estimated: true }} now={NOW} timeZone={ZONE} />);
    expect([...partOf(stripOf(DEMO_ARRIVAL), 'tags').children].map(tag => tag.dataset.occTag)).toEqual(['demo', 'estimated']);
  });

  it('counts down to its time and up after it («en 12 min», «ahora», «hace 3 min», «en 1 h 25 min»)', () => {
    const countdown = () => partOf(stripOf(DEMO_ARRIVAL), 'countdown');
    const { rerender } = render(strip());
    expect(countdown()).toHaveTextContent(/^en 12 min$/);
    rerender(strip({ now: Date.parse('2026-11-14T18:44:20Z') }));
    expect(countdown()).toHaveTextContent(/^ahora$/);
    rerender(strip({ now: Date.parse('2026-11-14T18:47:00Z') }));
    expect(countdown()).toHaveTextContent(/^hace 3 min$/);
    rerender(strip({ flight: { ...DEMO_ARRIVAL, time: { at: '2026-11-14T19:57:00Z', kind: 'scheduled' } } }));
    expect(countdown()).toHaveTextContent(/^en 1 h 25 min$/);
    // No clock given, or no time for the flight: no countdown at all, never «ahora».
    rerender(strip({ now: undefined }));
    expect(countdown()).toBeEmptyDOMElement();
    rerender(strip({ flight: { ...DEMO_ARRIVAL, time: null } }));
    expect(countdown()).toBeEmptyDOMElement();
    expect(partOf(stripOf(DEMO_ARRIVAL), 'time')).toHaveTextContent('Sin hora');
    rerender(strip({ flight: { ...DEMO_ARRIVAL, time: { at: 'pronto', kind: 'estimated' } } }));
    expect(countdown()).toBeEmptyDOMElement();
    expect(partOf(stripOf(DEMO_ARRIVAL), 'time')).toHaveTextContent('Sin hora');
  });

  it('an arrival on its runway time says «aterrizó hace»: that time only says that it landed (N23)', () => {
    // ZZ9001 touched down at 14:24, as the feed or the demo worker writes it (`actualKind: 'Runway'`).
    const landed = { ...DEMO_ARRIVAL, time: { at: '2026-11-14T18:24:00Z', kind: 'actual', actualKind: 'Runway' },
      status: { label: 'Aterrizó', signal: null } };
    const countdown = () => partOf(stripOf(DEMO_ARRIVAL), 'countdown');
    const { rerender } = render(strip({ flight: landed, onSelect: vi.fn() }));
    expect(countdown()).toHaveTextContent(/^aterrizó hace 8 min$/);
    expect(screen.getByRole('button', {
      name: 'Llegada, 14:24 real, ZZ9001, Demo, desde MIA, posición A7, Aterrizó, aterrizó hace 8 min',
    })).toBe(stripOf(DEMO_ARRIVAL));
    // In the same minute it is «ahora», as any time.
    rerender(strip({ flight: landed, now: Date.parse('2026-11-14T18:24:40Z') }));
    expect(countdown()).toHaveTextContent(/^ahora$/);
    // OCC's on-block time, a departure's take-off and a time that tells no kind keep the plain words.
    rerender(strip({ flight: { ...landed, time: { ...landed.time, actualKind: 'OnBlock' } } }));
    expect(countdown()).toHaveTextContent(/^hace 8 min$/);
    rerender(strip({ flight: { ...landed, direction: 'Departure' } }));
    expect(countdown()).toHaveTextContent(/^hace 8 min$/);
    rerender(strip({ flight: { ...landed, time: { at: landed.time.at, kind: 'actual' } } }));
    expect(countdown()).toHaveTextContent(/^hace 8 min$/);
    cleanup();

    resetLanguageForTests('en');
    render(<LanguageScope>{strip({ flight: landed })}</LanguageScope>);
    expect(countdown()).toHaveTextContent(/^landed 8 min ago$/);
  });

  it('is a toggle button with aria-pressed and the cyan casing when selected, and plain text without onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(strip({ onSelect, 'data-testid': 'flight-list-item', className: 'border-b' }));
    const button = screen.getByRole('button', { name: DEMO_NAME });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('data-testid', 'flight-list-item');
    expect(classesOf(button)).not.toContain('outline-occ-accent');
    expect(classesOf(button).at(-1)).toBe('border-b');
    await user.click(button);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(DEMO_ARRIVAL);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(2);

    rerender(strip({ onSelect, selected: true }));
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(classesOf(button)).toEqual(expect.arrayContaining(OCC_FLIGHT_STRIP_LAYOUT.selected.split(' ')));
    expect(classesOf(button)).toEqual(expect.arrayContaining(['outline-2', 'outline-occ-accent']));

    // Without onSelect it is text, not a control: nothing to press, nothing for Tab.
    rerender(strip({ selected: true }));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const text = stripOf(DEMO_ARRIVAL);
    expect(text.tagName).toBe('DIV');
    expect(text).not.toHaveAttribute('aria-pressed');
    expect(text).not.toHaveAttribute('tabindex');
    expect(text).toHaveTextContent('ZZ9001');
  });

  it('a status signal draws its glyph and word; a normal status carries no hue; English inside the scope', () => {
    const urgent = { ...DEPARTURE, id: 'l:aa907', flightNumber: 'AA907', status: { label: 'Otra aeronave en su posición', signal: 'urgent' } };
    render(<>{strip()}<OccFlightStrip flight={WITHOUT_STAND} timeZone={ZONE} /><OccFlightStrip flight={urgent} timeZone={ZONE} /></>);
    const attention = partOf(stripOf(WITHOUT_STAND), 'status');
    expect(attention.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
    expect(attention.querySelector('[data-occ-glyph]')).toHaveAttribute('aria-hidden', 'true');
    expect(within(attention).getByText('Atención:')).toHaveClass('sr-only');
    expect(attention).toHaveTextContent('Llegada sin posición asignada');
    expect(partOf(stripOf(urgent), 'status').querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'octagon');
    // A normal status: no glyph and no hue anywhere on the strip.
    const normal = stripOf(DEMO_ARRIVAL);
    expect(partOf(normal, 'status').querySelector('[data-occ-glyph]')).toBeNull();
    for (const element of [normal, ...normal.querySelectorAll('*')]) {
      expect(classesOf(element).filter(name => /occ-(?:warn|danger|accent)/.test(name))).toEqual([]);
    }
    cleanup();

    resetLanguageForTests('en');
    render(
      <LanguageScope>
        <OccFlightStrip flight={{ ...DEMO_ARRIVAL, status: { label: 'Approaching', signal: null } }} onSelect={vi.fn()}
          now={NOW} timeZone={ZONE} />
        <OccFlightStrip flight={{ ...DEPARTURE, standCode: null }} now={NOW} timeZone={ZONE} />
      </LanguageScope>,
    );
    expect(screen.getByRole('button', {
      name: 'Arrival, 14:44 estimated, ZZ9001, Demo, from MIA, stand A7, Approaching, in 12 min',
    })).toBeInTheDocument();
    const departure = stripOf(DEPARTURE);
    expect(within(partOf(departure, 'time')).getByText('sched.')).toBeInTheDocument();
    expect(partOf(departure, 'counterpart')).toHaveTextContent('to MIA');
    expect(partOf(departure, 'stand')).toHaveTextContent('No stand');
    cleanup();

    // A typo in the board model never draws a silent strip.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccFlightStrip flight={{ ...DEPARTURE, direction: 'Outbound' }} />)).toThrow(RangeError);
      expect(() => render(<OccFlightStrip flight={{ ...DEPARTURE, time: { at: DEPARTURE.time.at, kind: 'planned' } }} />))
        .toThrow(RangeError);
      expect(() => render(<OccFlightStrip flight={{ ...DEPARTURE, status: { label: 'Tarde', signal: 'delayed' } }} />))
        .toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
