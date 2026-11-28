import { useTranslation } from '../../../i18n/LanguageScope';
import { OCC_SHORTCUTS } from '../../occ-ui/occShortcuts';
import { VIEW_NAMES } from '../core/cameraPresets';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import Map3dToggle from './Map3dToggle';
import { RAIL_BUTTON, RAIL_KEY } from './railClasses';

// The views of the key table (0 Mundo · 1 Región · 2 Aproximación · 3 Aeródromo · 4 Rampa), with their own words. «0 Mundo»
// (M8) shows only on a map that has the world view (OccMapContext's `views`, Monitoreo's globe).
const VIEW_BUTTONS = Object.freeze(OCC_SHORTCUTS
  .filter(({ action }) => action.startsWith('view.'))
  .map(({ key, action, es, en }) => Object.freeze({ view: action.slice('view.'.length), key, label: { es, en } })));

// The words the rail shows (occ-map.css); the full word stays the button's name.
const SHORT_LABELS = Object.freeze({
  approach: Object.freeze({ es: 'Aprox.', en: 'Appr.' }),
  airfield: Object.freeze({ es: 'Aeród.', en: 'Airf.' }),
});

/**
 * The view selector of an OccMap, at the head of its control rail (ui/MapDock.jsx, CN-32): one slab with the views of the
 * map (the four, and «Mundo» first where the map has the globe, M8),
 * one under the other, each with its key and its word, the short one for «Aproximación» and «Aeródromo» (the full word
 * stays the button's name and its title). The pressed button is the view the camera really shows, so it stays truthful
 * after a free zoom; a click flies to the view and writes `view=` in the URL. The pressed view is told by its cyan frame
 * as well as by its tint, never by colour alone. The 2D/3D control (PR M7, ui/Map3dToggle.jsx) comes right after it,
 * so every rail with the views offers it. `views` (M9) lists the views it offers, those of its map by default
 * (OccMapContext's `views`: the four, the world and the four on Monitoreo's globe, or the ones a map fixed on the
 * airport keeps): the others show no button, and their keys do nothing on that map.
 * `toggle3d={false}` leaves the 2D/3D control to a screen that has its own in the rail (Mapa de posiciones, M9).
 */
export default function MapPresetSwitcher({ className = '', views: viewsProp, toggle3d = true }) {
  const { activeView, requestView, engineStatus, views: mapViews } = useOccMap();
  const offered = Array.isArray(viewsProp) ? viewsProp : Array.isArray(mapViews) ? mapViews : VIEW_NAMES;
  const { t, language } = useTranslation(mapMessages);
  const buttons = VIEW_BUTTONS.filter(({ view }) => offered.includes(view));

  return (
    <>
      <div
        role="group"
        aria-label={t('view.group')}
        data-testid="map-preset-switcher"
        className={`flex flex-col gap-px rounded border border-occ-line bg-occ-panel p-px ${className}`.trim()}
      >
        {buttons.map(({ view, key, label }) => {
          const pressed = activeView === view;
          const word = label[language] ?? label.es;
          return (
            <button
              key={view}
              type="button"
              aria-pressed={pressed}
              aria-keyshortcuts={key}
              title={`${word} (${key})`}
              disabled={engineStatus === 'unavailable'}
              onClick={() => requestView(view)}
              className={`${RAIL_BUTTON} rounded-sm border ${pressed
                ? 'border-occ-accent bg-occ-accent-soft text-occ-text'
                : 'border-transparent text-occ-muted hover:bg-occ-panel-raised hover:text-occ-text'}`}
            >
              <span aria-hidden="true" className={RAIL_KEY}>{key}</span>
              {/* The rail (occ-map.css) shows the short word and keeps the full one for assistive technology. */}
              <span className="occ-map-label-full min-w-0 truncate">{word}</span>
              {SHORT_LABELS[view] ? (
                <span aria-hidden="true" className="occ-map-label-short">
                  {SHORT_LABELS[view][language] ?? SHORT_LABELS[view].es}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {toggle3d ? <Map3dToggle /> : null}
    </>
  );
}
