import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccTimeline, { OCC_TIMELINE_DENSITIES, OCC_TIMELINE_LAYOUT, OCC_TIMELINE_TEXTURES } from './OccTimeline';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

// Punta Cana is UTC−4: the window 12:00–16:00 at the station is 16:00–20:00 UTC, and «ahora» is 14:32.
const ZONE = 'America/Santo_Domingo';
const START = '2026-11-14T16:00:00Z';
const END = '2026-11-14T20:00:00Z';
const NOW = Date.parse('2026-11-14T18:32:00Z');

const visit = overrides => ({
  startKind: 'scheduled', endKind: 'scheduled', estimated: false, demo: false, conflict: null, inOperation: false,
  ...overrides,
});
const ROWS = Object.freeze([
  { id: 'A5', label: 'A5', bars: [
    visit({ id: 'tat-1', arrivalFlight: 'AA904', departureFlight: 'AA905', startAt: '2026-11-14T18:40:00Z',
      startKind: 'estimated', endAt: '2026-11-14T19:35:00Z', state: 'onStand', inOperation: true }),
    visit({ id: 'tat-0', arrivalFlight: 'AA900', departureFlight: 'AA901', startAt: '2026-11-14T16:10:00Z',
      startKind: 'actual', endAt: '2026-11-14T17:20:00Z', endKind: 'actual', state: 'departed' }),
  ] },
  { id: 'A7', label: 'A7', bars: [
    visit({ id: 'demo-1', arrivalFlight: 'ZZ9001', departureFlight: 'ZZ9002', startAt: '2026-11-14T18:44:00Z',
      startKind: 'estimated', endAt: '2026-11-14T19:44:00Z', state: 'planned', estimated: true, demo: true }),
  ] },
  { id: 'A6', label: 'A6', bars: [] },
  { id: 'B20', label: 'B20', bars: [
    visit({ id: 'tat-3', arrivalFlight: 'AA910', departureFlight: 'AA911', startAt: '2026-11-14T19:10:00Z',
      endAt: '2026-11-14T19:50:00Z', state: 'planned' }),
  ] },
  { id: 'B21', label: 'B21', bars: [
    visit({ id: 'tat-2', arrivalFlight: 'DM161', departureFlight: 'DM162', startAt: '2026-11-14T18:55:00Z',
      startKind: 'estimated', endAt: null, endKind: null, state: 'planned', estimated: true,
      conflict: { label: 'Otra aeronave llega a esta posición', signal: 'urgent' } }),
    visit({ id: 'tat-out', arrivalFlight: 'AA700', departureFlight: 'AA701', startAt: '2026-11-14T21:00:00Z',
      endAt: '2026-11-14T22:00:00Z', state: 'planned' }),
  ] },
]);

// A conflict in each tone of contratos 2.4: attention (named, and the default) and urgent.
const CONFLICT_ROWS = Object.freeze([
  { id: 'B20', label: 'B20', bars: [
    visit({ id: 'late', arrivalFlight: 'AA900', departureFlight: 'AA901', startAt: '2026-11-14T16:10:00Z',
      startKind: 'actual', endAt: '2026-11-14T18:20:00Z', state: 'onStand',
      conflict: { label: 'Pasó su hora de salida', signal: 'attention' } }),
    visit({ id: 'uncovered', arrivalFlight: 'AA910', departureFlight: 'AA911', startAt: '2026-11-14T19:10:00Z',
      endAt: '2026-11-14T19:50:00Z', state: 'planned', conflict: { label: 'Sin agente que la cubra' } }),
  ] },
  { id: 'B21', label: 'B21', bars: [
    visit({ id: 'clash', arrivalFlight: 'DM161', departureFlight: 'DM162', startAt: '2026-11-14T18:55:00Z',
      endAt: '2026-11-14T19:45:00Z', state: 'planned',
      conflict: { label: 'Otra aeronave llega a esta posición', signal: 'urgent' } }),
  ] },
]);

const NAMES = Object.freeze({
  'tat-0': 'AA900 a AA901, posición A5, llega 12:10 real, sale 13:20 real, salió',
  'tat-1': 'AA904 a AA905, posición A5, llega 14:40 estimada, sale 15:35 programada, en operación',
  'demo-1': 'ZZ9001 a ZZ9002, posición A7, llega 14:44 estimada, sale 15:44 programada, planificada, demo, posición estimada',
  'tat-3': 'AA910 a AA911, posición B20, llega 15:10 programada, sale 15:50 programada, planificada',
  'tat-2': 'DM161 a DM162, posición B21, llega 14:55 estimada, sin salida, planificada, posición estimada, '
    + 'Urgente: Otra aeronave llega a esta posición',
});

function band(props) {
  return (
    <OccTimeline label="Posiciones en el tiempo" rows={ROWS} windowStart={START} windowEnd={END} now={NOW} timeZone={ZONE}
      {...props} />
  );
}

const classesOf = element => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const barOf = id => document.querySelector(`[data-occ-bar="${id}"]`);
const rowOf = id => document.querySelector(`[data-occ-timeline-row="${id}"]`);
const percentOf = value => Number.parseFloat(value);

describe('OccTimeline', () => {
  it('draws one row per stand with its plate and each bar where its times fall', () => {
    render(band({ className: 'max-h-80' }));
    const group = screen.getByRole('group', { name: 'Posiciones en el tiempo' });
    expect(classesOf(group)).toEqual(expect.arrayContaining(OCC_TIMELINE_LAYOUT.root.split(' ')));
    expect(classesOf(group).at(-1)).toBe('max-h-80');
    // One row per stand, in the given order, each with its plate, even a stand without visits.
    const rows = [...group.querySelectorAll('[data-occ-timeline-row]')];
    expect(rows.map(row => row.dataset.occTimelineRow)).toEqual(['A5', 'A7', 'A6', 'B20', 'B21']);
    for (const row of rows) {
      expect(within(row).getByText(row.dataset.occTimelineRow)).toHaveAttribute('data-occ-plate', 'stand');
    }
    expect(within(rowOf('A6')).queryAllByRole('button')).toEqual([]);
    // Each bar where its times fall: 14:40 to 15:35 in a window of 12:00 to 16:00.
    expect(percentOf(barOf('tat-1').style.left)).toBeCloseTo(66.667, 2);
    expect(percentOf(barOf('tat-1').style.width)).toBeCloseTo(22.917, 2);
    expect(percentOf(barOf('tat-0').style.left)).toBeCloseTo(4.167, 2);
    // No departure yet: open to the end of the window.
    expect(percentOf(barOf('tat-2').style.left) + percentOf(barOf('tat-2').style.width)).toBeCloseTo(100, 2);
    // A visit outside the window is not drawn.
    expect(barOf('tat-out')).toBeNull();
    expect(within(rowOf('B21')).getAllByRole('button')).toHaveLength(1);
    // Within a row the bars follow time, for the keyboard and for a screen reader alike.
    expect(within(rowOf('A5')).getAllByRole('button').map(bar => bar.dataset.occBar)).toEqual(['tat-0', 'tat-1']);
    // The axis of the station's full hours is for the eye only.
    const axis = group.querySelector('[data-occ-timeline-axis]');
    expect(axis).toHaveAttribute('aria-hidden', 'true');
    expect([...axis.querySelectorAll('[data-occ-hour]')].map(tick => tick.textContent))
      .toEqual(['12:00', '13:00', '14:00', '15:00', '16:00']);
    expect(group.querySelectorAll('[data-occ-hour-line]')).toHaveLength(5);
    // The compact rows are shorter; both are 44 px high on a touch screen.
    expect(OCC_TIMELINE_DENSITIES).toEqual(['normal', 'compact']);
    expect(OCC_TIMELINE_LAYOUT.track.compact).toMatch(/(?:^|\s)h-6(?:\s|$)/);
    for (const track of Object.values(OCC_TIMELINE_LAYOUT.track)) expect(track).toContain('[@media(pointer:coarse)]:h-11');
  });

  it('every bar is a button with its full accessible name and aria-pressed when selected; Enter and click call onSelectBar', async () => {
    const user = userEvent.setup();
    const onSelectBar = vi.fn();
    render(band({ selectedBarId: 'tat-1', onSelectBar }));
    for (const [id, name] of Object.entries(NAMES)) {
      const bar = screen.getByRole('button', { name });
      expect(bar).toBe(barOf(id));
      expect(bar).toHaveAttribute('type', 'button');
      expect(bar).toHaveAttribute('aria-pressed', id === 'tat-1' ? 'true' : 'false');
    }
    // What the eye reads: «AA904 → AA905», the arrow hidden from a screen reader.
    expect(barOf('tat-1')).toHaveTextContent('AA904 → AA905');
    expect(within(barOf('tat-1')).getByText('→')).toHaveAttribute('aria-hidden', 'true');

    await user.click(barOf('demo-1'));
    expect(onSelectBar).toHaveBeenCalledExactlyOnceWith(ROWS[1].bars[0], ROWS[1]);
    barOf('tat-3').focus();
    await user.keyboard('{Enter}');
    expect(onSelectBar).toHaveBeenLastCalledWith(ROWS[3].bars[0], ROWS[3]);
    await user.keyboard(' ');
    expect(onSelectBar).toHaveBeenCalledTimes(3);
  });

  it('tells bars apart by texture: planned outline, estimated dashed, on stand solid, departed dim, demo stripes, conflict in its signal', () => {
    render(band({ selectedBarId: 'tat-3' }));
    const { states } = OCC_TIMELINE_TEXTURES;
    // Planned: a solid strong outline on nothing.
    expect(classesOf(barOf('tat-3'))).toEqual(expect.arrayContaining([states.planned.border, 'border-solid']));
    expect(classesOf(barOf('tat-3')).filter(name => name.startsWith('bg-') || name.startsWith('opacity-'))).toEqual([]);
    // Estimated: the outline dashed, the texture of «est.».
    expect(classesOf(barOf('demo-1'))).toContain('border-dashed');
    expect(classesOf(barOf('demo-1'))).not.toContain('border-solid');
    // On stand: the raised slab with a light outline; departed: the same slab, dimmed.
    expect(classesOf(barOf('tat-1'))).toEqual(expect.arrayContaining(['bg-occ-panel-raised', 'border-occ-text', 'border-solid']));
    expect(classesOf(barOf('tat-1'))).not.toContain('opacity-60');
    expect(classesOf(barOf('tat-0'))).toEqual(expect.arrayContaining(['bg-occ-panel-raised', 'opacity-60']));
    // Demo: the 45° stripes, a pattern of its own per bar; no other bar has them.
    const stripes = barOf('demo-1').querySelector('svg[data-occ-stripes]');
    expect(stripes).toHaveAttribute('aria-hidden', 'true');
    expect(stripes.querySelector('pattern')).toHaveAttribute('patternTransform', 'rotate(45)');
    expect(stripes.querySelector('line').style.stroke).toBe('var(--occ-line)');
    expect(stripes.querySelector('rect')).toHaveAttribute('fill', `url(#${stripes.querySelector('pattern').id})`);
    expect(document.querySelectorAll('svg[data-occ-stripes]')).toHaveLength(1);
    // Conflict: another aircraft arriving at the stand is urgent, the red outline instead of the state's and the octagon
    // next to the words (both tones in the next test).
    expect(classesOf(barOf('tat-2'))).toContain('border-occ-danger');
    expect(classesOf(barOf('tat-2'))).not.toContain(states.planned.border);
    expect(barOf('tat-2')).toHaveAttribute('data-conflict', 'urgent');
    expect(barOf('tat-2').querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'octagon');
    expect(barOf('tat-2').querySelector('[data-occ-glyph]')).toHaveAttribute('aria-hidden', 'true');
    // Cyan for the selection only; red for the urgent conflict only; nothing here asks for attention in amber; a bar
    // without a conflict has no glyph.
    for (const id of Object.keys(NAMES)) {
      const classes = classesOf(barOf(id));
      expect(classes.includes('outline-occ-accent'), id).toBe(id === 'tat-3');
      expect(classes.includes('border-occ-danger'), id).toBe(id === 'tat-2');
      expect(classes.filter(name => name.includes('warn')), id).toEqual([]);
      if (id !== 'tat-2') {
        expect(barOf(id).querySelector('[data-occ-glyph]'), id).toBeNull();
        expect(barOf(id), id).not.toHaveAttribute('data-conflict');
      }
      // Text never drops under 12 px.
      expect(classes).toContain('text-xs');
    }
    cleanup();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(band({ density: 'tiny' }))).toThrow(RangeError);
      expect(() => render(band({ rows: [{ id: 'A5', label: 'A5', bars: [visit({ id: 'x', state: 'parked' })] }] })))
        .toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('draws a conflict in the tone of its signal: amber triangle for attention, the default, red octagon for urgent', () => {
    render(band({ rows: CONFLICT_ROWS, selectedBarId: 'clash' }));
    const { conflict, states } = OCC_TIMELINE_TEXTURES;
    expect(conflict).toEqual({ attention: 'border-occ-warn', urgent: 'border-occ-danger' });
    const tones = [
      ['late', 'attention', 'triangle', states.onStand.border,
        'AA900 a AA901, posición B20, llega 12:10 real, sale 14:20 programada, en posición, Atención: Pasó su hora de salida'],
      ['uncovered', 'attention', 'triangle', states.planned.border,
        'AA910 a AA911, posición B20, llega 15:10 programada, sale 15:50 programada, planificada, '
          + 'Atención: Sin agente que la cubra'],
      ['clash', 'urgent', 'octagon', states.planned.border,
        'DM161 a DM162, posición B21, llega 14:55 programada, sale 15:45 programada, planificada, '
          + 'Urgente: Otra aeronave llega a esta posición'],
    ];
    for (const [id, signal, shape, stateBorder, name] of tones) {
      // Named with the word of its signal before its reason.
      const bar = screen.getByRole('button', { name });
      expect(bar, id).toBe(barOf(id));
      expect(bar, id).toHaveAttribute('data-conflict', signal);
      // One border colour per bar: the signal's, instead of the state's.
      const classes = classesOf(bar);
      expect(classes, id).not.toContain(stateBorder);
      expect(classes.filter(item => item.startsWith('border-occ-')), id).toEqual([conflict[signal]]);
      // The glyph of the signal next to the words, hidden from assistive technology.
      const glyphs = bar.querySelectorAll('[data-occ-glyph]');
      expect(glyphs, id).toHaveLength(1);
      expect(glyphs[0]).toHaveAttribute('data-occ-glyph', signal);
      expect(glyphs[0]).toHaveAttribute('data-shape', shape);
      expect(glyphs[0]).toHaveAttribute('aria-hidden', 'true');
    }
    // The selection keeps its cyan casing on the red outline: an outline and a border, never the same property.
    expect(classesOf(barOf('clash'))).toEqual(expect.arrayContaining(['outline-occ-accent', 'border-occ-danger']));
    cleanup();

    // The word of the signal follows the language; the reason is the console's own words.
    resetLanguageForTests('en');
    render(<LanguageScope>{band({ rows: CONFLICT_ROWS })}</LanguageScope>);
    expect(barOf('uncovered')).toHaveAccessibleName(/, planned, Attention: Sin agente que la cubra$/);
    expect(barOf('clash')).toHaveAccessibleName(/, planned, Urgent: Otra aeronave llega a esta posición$/);
    cleanup();

    // A plain notice is not a conflict, and a typo never draws a silent one.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const signal of ['notice', 'danger']) {
        const rows = [{ id: 'B21', label: 'B21', bars: [visit({ ...CONFLICT_ROWS[1].bars[0], conflict: { label: 'x', signal } })] }];
        expect(() => render(band({ rows })), signal).toThrow(RangeError);
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it('draws the «ahora» line at now with its time and hides it outside the window', () => {
    const { rerender } = render(band());
    const line = document.querySelector('[data-occ-now-line]');
    const label = document.querySelector('[data-occ-now-label]');
    // 14:32 in a window of 12:00 to 16:00.
    expect(percentOf(line.style.left)).toBeCloseTo(63.333, 2);
    expect(percentOf(label.style.left)).toBeCloseTo(63.333, 2);
    expect(label).toHaveTextContent(/^ahora 14:32$/);
    expect(classesOf(line)).toEqual(expect.arrayContaining(['w-px', 'bg-occ-text']));
    // For the eye only, and still: no animation on the line or its label.
    expect(line.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(label.closest('[aria-hidden="true"]')).not.toBeNull();
    for (const element of [line, label]) {
      expect(classesOf(element).filter(name => /animate-|transition/.test(name))).toEqual([]);
    }
    // Past the middle of the window the label ends at the line, so it never runs off the band.
    expect(classesOf(label)).toContain('-translate-x-full');
    rerender(band({ now: Date.parse('2026-11-14T16:45:00Z') }));
    expect(classesOf(document.querySelector('[data-occ-now-label]'))).not.toContain('-translate-x-full');
    expect(document.querySelector('[data-occ-now-label]')).toHaveTextContent('ahora 12:45');

    // Outside the window, or without a valid now, there is no line at all.
    for (const now of [Date.parse('2026-11-14T21:00:00Z'), Date.parse('2026-11-14T15:59:00Z'), undefined, 'luego']) {
      rerender(band({ now }));
      expect(document.querySelector('[data-occ-now-line]'), String(now)).toBeNull();
      expect(document.querySelector('[data-occ-now-label]'), String(now)).toBeNull();
    }
    cleanup();
    resetLanguageForTests('en');
    render(<LanguageScope>{band()}</LanguageScope>);
    expect(document.querySelector('[data-occ-now-label]')).toHaveTextContent('now 14:32');
    expect(screen.getByRole('button', {
      name: 'AA904 to AA905, stand A5, arrives 14:40 estimated, departs 15:35 scheduled, in operation',
    })).toBeInTheDocument();
  });

  it('moves between bars with the arrow keys, Home and End, keeping one tab stop', async () => {
    const user = userEvent.setup();
    const onSelectBar = vi.fn();
    const prevented = [];
    const stops = () => [...document.querySelectorAll('[data-occ-bar]')].filter(bar => bar.tabIndex === 0)
      .map(bar => bar.dataset.occBar);
    const { rerender } = render(
      <div onKeyDown={event => prevented.push([event.key, event.defaultPrevented])}>
        <button type="button">Antes</button>
        {band({ onSelectBar })}
        <button type="button">Después</button>
      </div>,
    );
    // Without a selection the one stop is the first bar.
    expect(stops()).toEqual(['tat-0']);
    rerender(
      <div onKeyDown={event => prevented.push([event.key, event.defaultPrevented])}>
        <button type="button">Antes</button>
        {band({ onSelectBar, selectedBarId: 'demo-1' })}
        <button type="button">Después</button>
      </div>,
    );
    expect(stops()).toEqual(['demo-1']);

    await user.click(screen.getByRole('button', { name: 'Antes' }));
    await user.tab();
    expect(barOf('demo-1')).toHaveFocus();
    // From here on, only the keys pressed inside the band.
    prevented.length = 0;
    // Left and right stay in the row: A7 has one bar.
    await user.keyboard('{ArrowLeft}');
    expect(barOf('demo-1')).toHaveFocus();
    // Up: the bar of A5 nearest in time.
    await user.keyboard('{ArrowUp}');
    expect(barOf('tat-1')).toHaveFocus();
    expect(stops()).toEqual(['tat-1']);
    await user.keyboard('{ArrowLeft}');
    expect(barOf('tat-0')).toHaveFocus();
    await user.keyboard('{End}');
    expect(barOf('tat-1')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(barOf('tat-0')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(barOf('tat-1')).toHaveFocus();
    // Down: A7, then past the empty A6 to B20, then B21; the last row goes no further.
    await user.keyboard('{ArrowDown}');
    expect(barOf('demo-1')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(barOf('tat-3')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(barOf('tat-2')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(barOf('tat-2')).toHaveFocus();
    expect(stops()).toEqual(['tat-2']);
    // Moving never selects, and the band keeps the keys it uses from scrolling the page.
    expect(onSelectBar).not.toHaveBeenCalled();
    expect(prevented.every(([, wasPrevented]) => wasPrevented)).toBe(true);
    expect(prevented.map(([key]) => key)).toEqual(['ArrowLeft', 'ArrowUp', 'ArrowLeft', 'End', 'Home', 'ArrowRight',
      'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']);

    // Tab leaves the band at once, and the stop goes back to the selected bar.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Después' })).toHaveFocus();
    expect(stops()).toEqual(['demo-1']);
    // A key the band does not use goes by untouched.
    fireEvent.keyDown(barOf('demo-1'), { key: 'd' });
    expect(prevented.at(-1)).toEqual(['d', false]);
  });
});
