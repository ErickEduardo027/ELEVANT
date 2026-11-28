'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { RAIL_KEY, railToolClass } from './railClasses';

// «Seguir en 3D» in the map's control rail (M4), under «Seguir» (ui/MapFollowButton.jsx): the same entry as the data
// block's button (the map context's `follow.three`), so choosing an aircraft and pressing it, the data block's button
// and a double click on the aircraft (core/OccMap.jsx) are one switch. It keeps its name and is pressed while the camera
// orbits the aircraft; pressed again it stops and flies the camera back. It waits, disabled, until the selection names
// an aircraft the map draws. It has no key of the key table (the eight keys stay): its title says the double click does
// the same, and the place of a key holds a small orbit mark so its word lines up with the others'.

function OrbitMark() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false" className="h-2.5 w-2.5">
      <ellipse cx="5" cy="5" rx="4.2" ry="2" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1 }} />
      <circle cx="5" cy="5" r="1.3" style={{ fill: 'currentColor' }} />
    </svg>
  );
}

/** The «Seguir en 3D» button of an OccMap's rail; nothing on a map that cannot follow, cannot draw or has no 3D follow. */
export default function MapFollow3dButton({ className = '' }) {
  const { follow, engineStatus } = useOccMap();
  const { t } = useTranslation(mapMessages);
  const three = follow?.three ?? null;
  if (!follow?.available || three === null || engineStatus === 'unavailable') return null;
  const on = three.on === true;
  const enabled = on || follow.canFollow === true;
  let title = t('follow.choose3d');
  if (on) title = t('follow.stop3d');
  else if (enabled) title = t('follow.title3d');
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!enabled}
      title={title}
      data-occ-follow3d=""
      onClick={on ? three.stop : three.start}
      className={railToolClass(on, `disabled:text-occ-faint ${on ? '' : 'disabled:hover:bg-occ-panel'} ${className}`)}
    >
      <span aria-hidden="true" className={`${RAIL_KEY} flex items-center justify-center`}><OrbitMark /></span>
      {t('follow.label3d')}
    </button>
  );
}
