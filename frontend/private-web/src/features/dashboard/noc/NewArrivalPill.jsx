'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useOccMap } from '../../maps/core/OccMapContext';
import DemoTag from '../../occ-ui/DemoTag';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_PRIMARY_ACTION } from './consoleStyles';
import { demoArrivalsSince, followView } from './newArrivals';

/**
 * The demo arrival the console announces (contratos 2.5): the newest active demo arrival that appeared in the map
 * flights since the console opened (newArrivals.js: demoArrivalsSince), or null. The first read only learns what is
 * there, so opening the console never announces a flight that was already on its way. `dismiss()` hides it.
 */
export function useNewDemoArrival(flights) {
  const seen = useRef(null);
  const [arrival, setArrival] = useState(null);
  useEffect(() => {
    if (!Array.isArray(flights)) return;
    const { seen: next, arrived } = demoArrivalsSince(seen.current, flights);
    seen.current = next;
    if (arrived.length > 0) setArrival(arrived.at(-1));
  }, [flights]);
  return { arrival, dismiss: () => setArrival(null) };
}

/**
 * The pill «Llegada nueva: ZZ9001» with its «Demo» tag, «Ver y seguir» and «Cerrar», at the top left of the area the
 * panels leave in sight. «Ver y seguir» calls `onFollow(flight, view)` with the view that follows it (newArrivals.js:
 * followView): the console writes the flight, `follow=1` and that view in the URL in one go (one writer, so no write
 * undoes another). The pill moves the camera itself: to that view, or, when the map already shows it, onto the flight.
 * Then it closes. Inside an OccMap it reads the map's context; outside one (the fallback grid) it only selects. A
 * status: the arrival is read out once, politely.
 */
export default function NewArrivalPill({ flight, onFollow, onDismiss, className = '' }) {
  const { t } = useTranslation(consoleMessages);
  const { activeView, flyToPreset, flyToFlight } = useOccMap();
  if (!flight) return null;

  function follow() {
    const view = followView(flight);
    onFollow?.(flight, view);
    if (activeView === view) flyToFlight(flight.flightKey);
    else flyToPreset(view);
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
