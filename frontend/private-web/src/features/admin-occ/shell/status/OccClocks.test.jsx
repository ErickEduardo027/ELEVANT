import { act, cleanup, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../../i18n/languageStore';
import OccClocks, { formatStationTime } from './OccClocks';

const FAKE_TIMERS = { toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] };
const LOCAL = 'Hora local de Punta Cana según el reloj de este equipo';
const UTC = 'Hora UTC según el reloj de este equipo';

function clocks() {
  return <LanguageScope><OccClocks /></LanguageScope>;
}

const clockAt = label => screen.getByLabelText(new RegExp(`^${label}: `));
const timeOf = label => clockAt(label).querySelector('time').textContent;

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete document.visibilityState;
  resetLanguageForTests();
});

describe('OccClocks', () => {
  it('shows local time first and UTC second without seconds', () => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(new Date('2026-11-12T18:32:45Z'));
    render(clocks());
    const [local, utc] = screen.getAllByRole('img');
    expect(local).toHaveAttribute('aria-label', `${LOCAL}: 14:32`);
    expect(utc).toHaveAttribute('aria-label', `${UTC}: 18:32`);
    expect(within(local).getByText('14:32')).toBeInTheDocument();
    expect(within(local).getByText('AST')).toBeInTheDocument();
    expect(within(utc).getByText('18:32')).toBeInTheDocument();
    expect(within(utc).getByText('UTC')).toBeInTheDocument();
    // Both name the same minute, in mono.
    for (const clock of [local, utc]) {
      expect(clock.querySelector('time')).toHaveAttribute('datetime', '2026-11-12T18:32:00.000Z');
      expect(clock.className.split(/\s+/)).toContain('font-mono');
    }
    expect(document.body.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    // 24-hour times, midnight included.
    expect(formatStationTime(Date.parse('2026-11-13T04:05:00Z'))).toBe('00:05');
    expect(formatStationTime('2026-11-12T23:59:00Z', 'en-US', 'UTC')).toBe('23:59');
    expect(formatStationTime(null)).toBe('--:--');
  });

  it('ticks on the minute boundary, not every 15 s', () => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(new Date('2026-11-12T18:07:50Z'));
    const interval = vi.spyOn(globalThis, 'setInterval');
    render(clocks());
    expect(timeOf(UTC)).toBe('18:07');
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(timeOf(UTC)).toBe('18:07');
    // Right at 18:08:00, not up to 15 s later.
    act(() => { vi.advanceTimersByTime(1); });
    expect(timeOf(UTC)).toBe('18:08');
    expect(timeOf(LOCAL)).toBe('14:08');
    act(() => { vi.advanceTimersByTime(59_999); });
    expect(timeOf(UTC)).toBe('18:08');
    act(() => { vi.advanceTimersByTime(1); });
    expect(timeOf(UTC)).toBe('18:09');
    // One timer to the next minute, never a fixed interval.
    expect(interval).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('catches up when the tab becomes visible', () => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(new Date('2026-11-12T18:07:10Z'));
    render(clocks());
    setVisibility('hidden');
    // A hidden tab: the browser holds its timers back while the clock moves on.
    vi.setSystemTime(new Date('2026-11-12T18:12:30Z'));
    expect(timeOf(UTC)).toBe('18:07');
    setVisibility('visible');
    expect(timeOf(UTC)).toBe('18:12');
    expect(timeOf(LOCAL)).toBe('14:12');
    // And it keeps to the minute from there.
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(timeOf(UTC)).toBe('18:13');
  });

  it('keeps the accessible names of both clocks', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T18:07:00Z'));
    render(clocks());
    const utc = screen.getByLabelText('Hora UTC según el reloj de este equipo: 18:07');
    expect(within(utc).getByText('18:07')).toHaveAttribute('datetime', '2026-11-12T18:07:00.000Z');
    expect(screen.getByLabelText('Hora local de Punta Cana según el reloj de este equipo: 14:07')).toBeInTheDocument();
    act(() => resetLanguageForTests('en'));
    expect(screen.getByLabelText('UTC time from this device clock: 18:07')).toBeInTheDocument();
    expect(screen.getByLabelText('Punta Cana local time from this device clock: 14:07')).toBeInTheDocument();
  });

  it('shows --:-- on the server, which does not know this device clock', () => {
    const html = renderToString(clocks());
    // Each clock shows --:-- and says it in its name.
    expect(html.match(/<time[^>]*>--:--<\/time>/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="${LOCAL}: --:--"`);
    expect(html).toContain(`aria-label="${UTC}: --:--"`);
    expect(html).not.toMatch(/\d{2}:\d{2}/);
    expect(html).not.toContain('datetime=');
  });
});
