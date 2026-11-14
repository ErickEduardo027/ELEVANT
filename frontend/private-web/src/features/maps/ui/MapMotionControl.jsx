'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { stationTime } from '../traffic/stationTime';

// «Pausar movimiento» (design H, PR M6): content that moves on its own for more than five seconds needs a way to pause
// it. The button freezes the map's render clock (core/frameLoop.js): the aircraft stand still where they are drawn
// while the reads go on, and the chip beside it says so with the station's time of the newest data. «Reanudar
// movimiento» goes back to the server's time. It has no key of its own (contracts 2.2: pause is a button). It goes in
// the map's dock (ui/MapDock.jsx), as a tool of its own size like the dock's other tools (its name is its label and
// its title), and shows only on a map that moves its traffic. The chip sits in the dock's own row, beside the button:
// the panels of the dock (the legend, the layers menu) open upwards over the map, never over it.

function MotionGlyph({ paused }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4 shrink-0">
      {paused
        ? <path d="M5 3.5 L12.5 8 L5 12.5 Z" style={{ fill: 'currentColor' }} />
        : <path d="M4.5 3.5 H7 V12.5 H4.5 Z M9 3.5 H11.5 V12.5 H9 Z" style={{ fill: 'currentColor' }} />}
    </svg>
  );
}

/** The pause control of an OccMap; nothing on a map that does not move its traffic, or that cannot draw. */
export default function MapMotionControl({ className = '' }) {
  const { motion, engineStatus } = useOccMap();
  const { t, locale } = useTranslation(mapMessages);
  if (!motion?.available || engineStatus === 'unavailable') return null;
  const { paused } = motion;
  const name = paused ? t('motion.resume') : t('motion.pause');
  const time = stationTime(motion.dataAt ?? motion.pausedAt, locale);
  return (
    <div data-testid="map-motion-control" className={`flex min-w-0 items-end gap-2 ${className}`.trim()}>
      {paused && (
        <p
          role="status"
          className="flex min-h-11 min-w-0 items-center rounded border border-occ-line bg-occ-panel-float px-3 text-sm text-occ-text"
        >
          {time === null ? t('motion.pausedWithoutData') : t('motion.paused', { time })}
        </p>
      )}
      <button
        type="button"
        aria-pressed={paused}
        aria-label={name}
        title={name}
        onClick={paused ? motion.resume : motion.pause}
        className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded border text-occ-text hover:bg-occ-panel-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent ${paused
          ? 'border-occ-accent bg-occ-accent-soft'
          : 'border-occ-line bg-occ-panel'}`}
      >
        <MotionGlyph paused={paused} />
      </button>
    </div>
  );
}
