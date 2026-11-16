'use client';

import { useSyncExternalStore } from 'react';
import { useTranslation } from '../../../../i18n/LanguageScope';
import { occShellMessages } from '../occShellMessages';

/** The station's time zone, and the abbreviation the bar prints after its time (Santo Domingo is UTC−4 all year). */
export const STATION_TIME_ZONE = 'America/Santo_Domingo';
export const STATION_ZONE = 'AST';

const EMPTY_TIME = '--:--';
const MINUTE_MS = 60_000;
const formatters = new Map();

function formatter(locale, timeZone) {
  const key = `${locale}|${timeZone}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }));
  }
  return formatters.get(key);
}

/** «14:32» for an instant (ms or ISO) at the station, or in `timeZone`; --:-- without a valid instant. */
export function formatStationTime(at, locale = 'es-DO', timeZone = STATION_TIME_ZONE) {
  let value = Number.NaN;
  if (typeof at === 'number') value = at;
  else if (typeof at === 'string') value = Date.parse(at);
  return Number.isFinite(value) ? formatter(locale, timeZone).format(value) : EMPTY_TIME;
}

// One minute clock for every clock of the tab. It wakes on the next minute boundary, never on a fixed interval, and
// catches up as soon as a hidden tab (whose timers the browser slows down) becomes visible again.
const listeners = new Set();
let timer = null;

function notify() {
  listeners.forEach(listener => listener());
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { notify(); schedule(); }, MINUTE_MS - (Date.now() % MINUTE_MS));
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') return;
  notify();
  schedule();
}

function subscribeMinute(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

const currentMinute = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
// The server does not know the viewer's clock: it renders --:-- and the browser fills the time in after hydrating.
const serverMinute = () => null;

function Clock({ label, time, zone, dateTime, className = '' }) {
  return (
    <span role="img" aria-label={label} className={`flex items-baseline gap-1 font-mono ${className}`}>
      <time dateTime={dateTime} className="text-sm font-medium tabular-nums text-occ-text">{time}</time>
      <span className="text-xs text-occ-muted">{zone}</span>
    </span>
  );
}

/**
 * The bar's two clocks, from this device's clock: the station's local time first, then UTC, without seconds. Each has
 * its own accessible name («Hora UTC según el reloj de este equipo: 18:07»). `utcClassName` places the UTC clock.
 */
export default function OccClocks({ className = '', utcClassName = '' }) {
  const { t, locale } = useTranslation(occShellMessages);
  const minute = useSyncExternalStore(subscribeMinute, currentMinute, serverMinute);
  const dateTime = minute === null ? undefined : new Date(minute).toISOString();
  const local = formatStationTime(minute, locale);
  const utc = formatStationTime(minute, locale, 'UTC');

  return (
    <div className={`flex shrink-0 items-center gap-3 ${className}`}>
      <Clock label={`${t('localClock')}: ${local}`} time={local} zone={STATION_ZONE} dateTime={dateTime} />
      <Clock label={`${t('utcClock')}: ${utc}`} time={utc} zone="UTC" dateTime={dateTime} className={utcClassName} />
    </div>
  );
}
