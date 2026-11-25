'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { stationTime } from '../traffic/stationTime';
import { railToolClass } from './railClasses';

// «Pausar movimiento» (design H, PR M6): content that moves on its own for more than five seconds needs a way to pause
// it. The button freezes the map's render clock (core/frameLoop.js): the aircraft stand still where they are drawn
// while the reads go on, and the chip beside it says so with the station's time of the newest data. «Reanudar
// movimiento» goes back to the server's time. It has no key of its own (contracts 2.2: pause is a button). It goes in
// the map's control rail (ui/MapDock.jsx, CN-32), as wide as the rail's other controls (its name is its label and its
// title), and shows only on a map that moves its traffic. The chip sits to the left of the button, over the map, at
// the button's own height: the rail's menus open over it.

function MotionGlyph({ paused }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4 shrink-0">
      {paused
        ? <path d="M5 3.5 L12.5 8 L5 12.5 Z" style={{ fill: 'currentColor' }} />
        : <path d="M4.5 3.5 H7 V12.5 H4.5 Z M9 3.5 H11.5 V12.5 H9 Z" style={{ fill: 'currentColor' }} />}
    </svg>
  );
}

/**
 * The pause control of an OccMap; nothing on a map that does not move its traffic, or that cannot draw. `compact`
 * (the console, whose provenance line under the map already says the time of its data) leaves out the status chip: the
 * button's name and icon say «Reanudar movimiento».
 */
export default function MapMotionControl({ compact = false, className = '' }) {
  const { motion, engineStatus } = useOccMap();
  const { t, locale } = useTranslation(mapMessages);
  if (!motion?.available || engineStatus === 'unavailable') return null;
  const { paused } = motion;
  const name = paused ? t('motion.resume') : t('motion.pause');
  const time = stationTime(motion.dataAt ?? motion.pausedAt, locale);
  return (
    <div data-testid="map-motion-control" className={`relative ${className}`.trim()}>
      {paused && !compact && (
        <p
          role="status"
          className="absolute right-full top-0 mr-2 flex min-h-8 w-max max-w-[18rem] items-center rounded border border-occ-line bg-occ-panel-float px-3 text-sm text-occ-text [@media(pointer:coarse)]:min-h-11"
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
        className={railToolClass(paused, 'justify-center')}
      >
        <MotionGlyph paused={paused} />
      </button>
    </div>
  );
}
