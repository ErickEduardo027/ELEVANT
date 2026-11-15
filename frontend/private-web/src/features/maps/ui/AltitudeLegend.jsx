'use client';

import { useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { ALTITUDE_STOPS_FT, altitudeGradient, mapColorsFor } from '../style/mapColors';

// The altitude scale of the traffic (owner request of 2026-11-15): «ALTITUD (ft)» over the gradient the aircraft are
// coloured with (style/mapColors.js, traffic/trafficLayers.js), its ticks at the stops (0 … 40 000+), and the light grey
// of an aircraft on the ground beside it. It sits at the bottom of the area in sight, just above the map's dock and
// inside the insets (occ-map.css: .occ-map-altitude), only while the map draws traffic on screen. Its own button folds
// it to its title and opens it again; folded it stays out of the way of the panels. Equal steps between the stops, as
// the ADS-B maps the OCC knows draw it: the low altitudes, where the airport works, get as much room as the high ones.

const THIN_SPACE = ' ';
const tickText = (feet, last) => `${String(feet).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)}${last ? '+' : ''}`;

/** The ticks of the scale: `[{ feet, text, at }]`, `at` the share of the bar in percent. */
export function altitudeTicks() {
  const last = ALTITUDE_STOPS_FT.length - 1;
  return ALTITUDE_STOPS_FT.map((feet, index) => ({ feet, text: tickText(feet, index === last), at: (index / last) * 100 }));
}

/** The altitude scale of an OccMap that draws traffic; nothing without traffic on screen or a map that cannot draw. */
export default function AltitudeLegend({ theme = 'dark', defaultOpen = true }) {
  const { trafficOnScreen, engineStatus } = useOccMap();
  const { t } = useTranslation(mapMessages);
  const [open, setOpen] = useState(defaultOpen);
  if (engineStatus === 'unavailable' || !(trafficOnScreen?.kinds?.length > 0)) return null;
  const ticks = altitudeTicks();
  const { ground } = mapColorsFor(theme).altitude;
  return (
    <div data-testid="altitude-legend" data-open={open ? 'true' : 'false'}
      className="occ-map-altitude rounded-md border border-occ-line bg-occ-panel-float px-2.5 py-1.5 text-occ-text">
      <div className="flex items-center gap-2">
        <button type="button" aria-expanded={open} title={open ? t('altitude.hide') : t('altitude.show')}
          onClick={() => setOpen(value => !value)}
          className="flex min-h-6 items-center gap-1 rounded text-[11px] font-semibold tracking-wide text-occ-muted hover:text-occ-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent">
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false" className={`h-2.5 w-2.5 ${open ? '' : '-rotate-90'}`}>
            <path d="M2 3.5 L5 6.5 L8 3.5" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }} />
          </svg>
          {t('altitude.title')}
        </button>
        {open && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-occ-muted">
            <span aria-hidden="true" data-altitude-ground="" className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: ground }} />
            {t('altitude.ground')}
          </span>
        )}
      </div>
      {open && (
        <div role="img" aria-label={t('altitude.label')} className="mt-1 px-2">
          <div data-altitude-bar="" className="h-2 rounded-sm" style={{ backgroundImage: altitudeGradient(theme) }} />
          <div aria-hidden="true" className="relative mt-0.5 h-3.5 font-mono text-[10px] leading-none text-occ-muted">
            {ticks.map(tick => (
              <span key={tick.feet} data-altitude-tick={tick.feet}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${tick.at}%` }}>
                {tick.text}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
