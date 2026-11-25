'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { OCC_SHORTCUTS } from '../../occ-ui/occShortcuts';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { RAIL_KEY, railToolClass } from './railClasses';

// «Seguir» (follow mode, PR M6, design A6): the camera follows the chosen aircraft and frames it with its next
// objective (core/OccMap.jsx). It goes in the map's control rail under the views and 3D (CN-32), and reads like them:
// the key of the key table before the word (S, contracts 2.2), pressed with the cyan frame of a pressed view, never by
// colour alone. It is a switch that keeps its name: pressed while the map follows, pressed again it stops (a screen
// reader says «Seguir, pressed», as the legend's button keeps «Leyenda» and says whether it is open). It writes
// `follow=1` through the map (OccMapContext's `follow`), so the S key, this button and the data block's «Seguir» are
// one switch. It waits, disabled, until the selection names an aircraft the map draws, and shows only on a map that
// moves its traffic frame by frame. When a person's drag ends follow mode, the map itself says so for a few seconds
// («Dejaste de seguir a ZZ9001. Pulsa Seguir para volver.», core/OccMap.jsx).

const FOLLOW_KEY = OCC_SHORTCUTS.find(({ action }) => action === 'toggleFollow').key.toUpperCase();

/** The follow button of an OccMap; nothing on a map that cannot follow or cannot draw. */
export default function MapFollowButton({ className = '' }) {
  const { follow, engineStatus } = useOccMap();
  const { t } = useTranslation(mapMessages);
  if (!follow?.available || engineStatus === 'unavailable') return null;
  const { following, canFollow, toggle } = follow;
  return (
    <button
      type="button"
      aria-pressed={following}
      aria-keyshortcuts={FOLLOW_KEY}
      disabled={!following && !canFollow}
      onClick={toggle}
      className={railToolClass(following,
        `disabled:text-occ-faint ${following ? '' : 'disabled:hover:bg-occ-panel'} ${className}`)}
    >
      <span aria-hidden="true" className={RAIL_KEY}>{FOLLOW_KEY}</span>
      {t('follow.label')}
    </button>
  );
}
