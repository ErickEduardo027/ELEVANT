'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useOccMap } from '../../maps/core/OccMapContext';
import DemoTag from '../../occ-ui/DemoTag';
import { readClosedArrivals, rememberClosedArrival } from './arrivalMemory';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_PRIMARY_ACTION } from './consoleStyles';
import { demoArrivalsSince, followView } from './newArrivals';

/**
 * The demo arrival the console announces (contratos 2.5), or null: the newest of the demo arrivals newArrivals.js
 * (demoArrivalsSince) finds in the map flights. On the console's first read, an active demo arrival still on its way to
 * its stand at the server's time (`clock.now()`), so a flight triggered before the console opened, reloaded or came
 * back from another module is announced; after it, one that appears. `arrival` is that flight as the last read has
 * it. `dismiss()` hides it and remembers for the tab session that `accountId` closed it (arrivalMemory.js): a closed
 * pill never comes back.
 */
export function useNewDemoArrival(flights, { clock = null, accountId = null } = {}) {
  const seen = useRef(null);
  const [arrival, setArrival] = useState(null);
  useEffect(() => {
    if (!Array.isArray(flights)) return;
    const nowMs = typeof clock?.now === 'function' ? clock.now() : null;
    const { seen: next, arrived } = demoArrivalsSince(seen.current, flights,
      { nowMs, closed: readClosedArrivals(accountId) });
    seen.current = next;
    if (arrived.length > 0) setArrival(arrived.at(-1));
  }, [accountId, clock, flights]);
  const dismiss = useCallback(() => {
    if (arrival !== null) rememberClosedArrival(arrival.flightKey, accountId);
    setArrival(null);
  }, [accountId, arrival]);
  // The flight as the last read has it: «Ver y seguir» picks its view by where it is now.
  const latest = arrival !== null && Array.isArray(flights)
    ? flights.find(row => row?.flightKey === arrival.flightKey) ?? arrival : arrival;
  return { arrival: latest, dismiss };
}

/**
 * The pill «Llegada nueva: ZZ9001» with its «Demo» tag, «Ver y seguir» and «Cerrar», at the top left of the area the
 * panels leave in sight. «Ver y seguir» calls `onFollow(flight, view, { viewShown })` with the view that follows it
 * (newArrivals.js: followView) and whether the map shows that view now: the console writes the flight, `follow=1` and
 * that view in the URL in one go (one writer, so no write undoes another) and moves the camera once the panels are
 * measured for the flight: to that view, unless the map shows it already, and then onto the flight when the map draws
 * its aircraft (ConsolePage.jsx). Then the pill closes, as «Cerrar» does (`onDismiss`). Inside an OccMap it reads the
 * view on screen from the map's context; outside one (the fallback grid) there is no camera, and it only selects. A
 * status: the arrival is read out once, politely.
 */
export default function NewArrivalPill({ flight, onFollow, onDismiss, className = '' }) {
  const { t } = useTranslation(consoleMessages);
  const { activeView } = useOccMap();
  if (!flight) return null;

  function follow() {
    const view = followView(flight);
    onFollow?.(flight, view, { viewShown: activeView === view });
    onDismiss?.();
  }

  return (
    <div role="status" data-occ-new-arrival={flight.flightKey}
      className={`pointer-events-auto flex flex-wrap items-center gap-2 rounded-[var(--occ-radius-overlay)] border border-occ-line-strong bg-occ-panel-float px-3 py-2 text-sm text-occ-text ${className}`}>
      <span className="font-semibold">{t('arrival.pill', { flight: flight.flightNumber })}</span>
      <DemoTag />
      <button type="button" onClick={follow} className={CONSOLE_PRIMARY_ACTION}>{t('arrival.follow')}</button>
      <button type="button" onClick={onDismiss} className={CONSOLE_ACTION}>{t('arrival.dismiss')}</button>
    </div>
  );
}
