import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n/languageStore';
import { occUiMessages } from './occUiMessages';
import { barGeometry, hourTicks, TIMELINE_BAR_STATES, timelineBarName, timeToFraction } from './occTimelineModel';

// Punta Cana is UTC−4: the window 12:00–16:00 at the station is 16:00–20:00 UTC.
const ZONE = 'America/Santo_Domingo';
const START = '2026-11-14T16:00:00Z';
const END = '2026-11-14T20:00:00Z';
const spanish = createTranslator(occUiMessages, 'es');
const english = createTranslator(occUiMessages, 'en');

const AA904 = Object.freeze({
  id: 'tat-1', arrivalFlight: 'AA904', departureFlight: 'AA905',
  startAt: '2026-11-14T18:40:00Z', startKind: 'estimated', endAt: '2026-11-14T19:35:00Z', endKind: 'scheduled',
  state: 'onStand', estimated: false, demo: false, conflict: null, inOperation: true,
});

describe('occTimelineModel', () => {
  it('timeToFraction clamps to the window and rejects invalid instants', () => {
    expect(timeToFraction(START, START, END)).toBe(0);
    expect(timeToFraction('2026-11-14T18:00:00Z', START, END)).toBe(0.5);
    expect(timeToFraction(Date.parse('2026-11-14T19:00:00Z'), START, END)).toBe(0.75);
    expect(timeToFraction(END, START, END)).toBe(1);
    // Outside the window it holds to the edge.
    expect(timeToFraction('2026-11-14T10:00:00Z', START, END)).toBe(0);
    expect(timeToFraction('2026-11-15T02:00:00Z', START, END)).toBe(1);
    // Not an instant, or not a window.
    expect(timeToFraction(null, START, END)).toBeNaN();
    expect(timeToFraction('luego', START, END)).toBeNaN();
    expect(timeToFraction(START, END, START)).toBeNaN();
    expect(timeToFraction(START, START, START)).toBeNaN();
    expect(timeToFraction(START, undefined, END)).toBeNaN();
  });

  it('barGeometry clips a bar to the window, leaves a missing leg open and drops a bar outside', () => {
    // Wholly inside: 14:40 to 15:35 at the station.
    expect(barGeometry(AA904, START, END)).toEqual({
      left: 160 / 240, width: 55 / 240, openStart: false, openEnd: false, clippedStart: false, clippedEnd: false,
    });
    // Began before the window: cut at its start.
    expect(barGeometry({ startAt: '2026-11-14T15:00:00Z', endAt: '2026-11-14T17:00:00Z' }, START, END)).toEqual({
      left: 0, width: 60 / 240, openStart: false, openEnd: false, clippedStart: true, clippedEnd: false,
    });
    expect(barGeometry({ startAt: '2026-11-14T19:30:00Z', endAt: '2026-11-14T21:00:00Z' }, START, END)).toEqual({
      left: 210 / 240, width: 30 / 240, openStart: false, openEnd: false, clippedStart: false, clippedEnd: true,
    });
    // No departure yet: open to the end of the window; no arrival: open from its start.
    expect(barGeometry({ startAt: '2026-11-14T19:00:00Z', endAt: null }, START, END)).toEqual({
      left: 180 / 240, width: 60 / 240, openStart: false, openEnd: true, clippedStart: false, clippedEnd: false,
    });
    expect(barGeometry({ startAt: null, endAt: '2026-11-14T17:00:00Z' }, START, END)).toEqual({
      left: 0, width: 60 / 240, openStart: true, openEnd: false, clippedStart: false, clippedEnd: false,
    });
    expect(barGeometry({ startAt: 'sin hora', endAt: undefined }, START, END)).toEqual({
      left: 0, width: 1, openStart: true, openEnd: true, clippedStart: false, clippedEnd: false,
    });
    // A moment (arrival and departure at once) keeps its place with no width.
    expect(barGeometry({ startAt: '2026-11-14T18:00:00Z', endAt: '2026-11-14T18:00:00Z' }, START, END))
      .toMatchObject({ left: 0.5, width: 0 });
    // Outside the window, ending where it begins, backwards, or no window at all: nothing to draw.
    expect(barGeometry({ startAt: '2026-11-14T13:00:00Z', endAt: '2026-11-14T15:00:00Z' }, START, END)).toBeNull();
    expect(barGeometry({ startAt: '2026-11-14T20:30:00Z', endAt: null }, START, END)).toBeNull();
    expect(barGeometry({ startAt: null, endAt: START }, START, END)).toBeNull();
    expect(barGeometry({ startAt: END, endAt: '2026-11-14T21:00:00Z' }, START, END)).toBeNull();
    expect(barGeometry({ startAt: '2026-11-14T19:00:00Z', endAt: '2026-11-14T18:00:00Z' }, START, END)).toBeNull();
    expect(barGeometry(AA904, END, START)).toBeNull();
  });

  it('hourTicks labels full hours in the station time zone across midnight', () => {
    // 12:00 to 16:00 at the station, both ends included.
    expect(hourTicks(START, END, ZONE, 'es-DO').map(({ label, fraction }) => [label, fraction])).toEqual([
      ['12:00', 0], ['13:00', 0.25], ['14:00', 0.5], ['15:00', 0.75], ['16:00', 1],
    ]);
    // 22:30 to 02:30 at the station: the night runs through 00:00.
    const night = hourTicks('2026-11-15T02:30:00Z', '2026-11-15T06:30:00Z', ZONE, 'es-DO');
    expect(night.map(tick => tick.label)).toEqual(['23:00', '00:00', '01:00', '02:00']);
    expect(night.map(tick => tick.fraction)).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(night[1].at).toBe(Date.parse('2026-11-15T04:00:00Z'));
    // Full hours of the station, not of UTC: a zone half an hour off UTC puts them on the half hours of UTC.
    const kolkata = hourTicks('2026-11-14T00:00:00Z', '2026-11-14T03:00:00Z', 'Asia/Kolkata', 'en-US');
    expect(kolkata.map(tick => tick.label)).toEqual(['06:00', '07:00', '08:00']);
    expect(kolkata.map(tick => new Date(tick.at).toISOString())).toEqual([
      '2026-11-14T00:30:00.000Z', '2026-11-14T01:30:00.000Z', '2026-11-14T02:30:00.000Z',
    ]);
    expect(hourTicks(END, START, ZONE, 'es-DO')).toEqual([]);
    expect(hourTicks('ayer', END, ZONE, 'es-DO')).toEqual([]);
  });

  it('timelineBarName says flights, stand, times with their kind and state («AA904 a AA905, posición A5, llega 14:40 estimada, sale 15:35 programada, en operación»)', () => {
    const words = { t: spanish, locale: 'es-DO', timeZone: ZONE };
    expect(TIMELINE_BAR_STATES).toEqual(['planned', 'onStand', 'departed']);
    expect(timelineBarName(AA904, { label: 'A5' }, words))
      .toBe('AA904 a AA905, posición A5, llega 14:40 estimada, sale 15:35 programada, en operación');
    // Not in operation: its state; then demo, estimated position and the conflict's own words.
    expect(timelineBarName({
      ...AA904, arrivalFlight: 'ZZ9001', departureFlight: 'ZZ9002', startAt: '2026-11-14T18:44:00Z', endAt: null,
      endKind: null, state: 'planned', inOperation: false, demo: true, estimated: true,
      conflict: { label: 'Otra aeronave llega a esta posición' },
    }, { label: 'A7' }, words)).toBe('ZZ9001 a ZZ9002, posición A7, llega 14:44 estimada, sin salida, planificada, demo, '
      + 'posición estimada, Otra aeronave llega a esta posición');
    expect(timelineBarName({
      ...AA904, startAt: null, startKind: null, endKind: 'actual', state: 'departed', inOperation: false,
    }, { label: 'A5' }, words)).toBe('AA904 a AA905, posición A5, sin llegada, sale 15:35 real, salió');
    expect(timelineBarName({ ...AA904, state: 'onStand', inOperation: false }, { label: 'A5' }, words))
      .toBe('AA904 a AA905, posición A5, llega 14:40 estimada, sale 15:35 programada, en posición');
    // One leg only, and a kind it does not know (left out rather than read as a key).
    expect(timelineBarName({ ...AA904, departureFlight: null, startKind: 'guessed', inOperation: false }, { label: 'B21' }, words))
      .toBe('AA904, posición B21, llega 14:40, sale 15:35 programada, en posición');
    expect(timelineBarName(AA904, { label: 'A5' }, { t: english, locale: 'en-US', timeZone: ZONE }))
      .toBe('AA904 to AA905, stand A5, arrives 14:40 estimated, departs 15:35 scheduled, in operation');
    expect(() => timelineBarName({ ...AA904, state: 'parked' }, { label: 'A5' }, words)).toThrow(RangeError);
  });
});
