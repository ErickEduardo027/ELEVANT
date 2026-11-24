'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { OCC_SHORTCUTS } from '../../occ-ui/occShortcuts';
import { LAYER_GROUPS, LOCKED_LAYERS } from '../core/layersMenu';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { RAIL_FLYOUT, RAIL_KEY, railToolClass } from './railClasses';

// The layers menu of an OccMap (design E7): a «Capas» button in the map's control rail (CN-32) and a panel that flies out
// to the left of the rail (occ-map.css: .occ-map-flyout), with one fieldset per group of core/layersMenu.js, listing
// only the keys the map can show. It and the legend share that place, so opening one closes the other (ui/MapLegend.jsx). The choices live in OccMap (kept in the
// browser as differences from the defaults of the view on screen); the menu only draws them. L opens and closes it from
// the map (contracts 2.2), and Esc closes it first, so one Esc never also clears the selection.

const SHORTCUT = OCC_SHORTCUTS.find(row => row.action === 'toggleLayers');

/**
 * The menu goes inside an OccMap, in its MapDock (it reads the map's layers from OccMapContext). A map that cannot draw,
 * or that has none of the menu's layers, shows no menu.
 */
export default function MapLayersMenu({ className = '' }) {
  const { layers, setLayer, layersMenuOpen: open, setLayersMenuOpen, registerLayersMenu, engineStatus } = useOccMap();
  const { t, language } = useTranslation(mapMessages);
  const panelId = useId();
  const idPrefix = useId();
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const groups = LAYER_GROUPS
    .map(group => ({ id: group.id, keys: group.keys.filter(key => layers.keys.includes(key)) }))
    .filter(group => group.keys.length > 0);
  const available = engineStatus !== 'unavailable' && groups.length > 0;

  // L works only while a menu is on screen: the map counts the menus it shows.
  useEffect(() => (available ? registerLayersMenu() : undefined), [available, registerLayersMenu]);

  // Esc inside the menu (its button or a checkbox) closes it, marked as used, and gives the focus back to its button. A
  // listener of its own on the menu runs before the map's keys, which listen further up, on the map's root.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !open) return undefined;
    const onKeyDown = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setLayersMenuOpen(false);
      buttonRef.current?.focus();
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [open, setLayersMenuOpen]);

  if (!available) return null;
  const key = SHORTCUT.key.toUpperCase();

  return (
    // No position of its own: the panel is placed against the rail (occ-map.css), as the legend's.
    <div ref={rootRef} data-testid="map-layers-menu" className={className || undefined}>
      <div
        id={panelId}
        role="group"
        aria-label={t('layers.menu')}
        hidden={!open}
        className={`${RAIL_FLYOUT} w-72 space-y-3`}
      >
        {groups.map(group => (
          <fieldset key={group.id} className="space-y-1">
            <legend className="mb-1 text-xs font-semibold text-occ-muted">{t(`layers.group.${group.id}`)}</legend>
            {group.keys.map(layer => {
              const locked = LOCKED_LAYERS.includes(layer);
              const inputId = `${idPrefix}-${layer}`;
              const hintId = `${inputId}-hint`;
              // What a weather key that is on says when the map shows nothing of it, or the time of its image (PR M8).
              const note = locked ? null : layers.notes?.[layer] ?? null;
              return (
                <div key={layer} className="flex min-h-9 items-start gap-2 py-1">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={layers.values[layer] === true}
                    disabled={locked}
                    aria-describedby={locked || note !== null ? hintId : undefined}
                    onChange={event => setLayer(layer, event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-occ-accent disabled:cursor-not-allowed"
                  />
                  <span className="min-w-0">
                    <label htmlFor={inputId} className={locked ? 'cursor-not-allowed' : 'cursor-pointer'}>
                      {t(`layers.key.${layer}`)}
                    </label>
                    {locked && <span id={hintId} className="block text-xs text-occ-muted">{t('layers.locked')}</span>}
                    {note !== null && <span id={hintId} className="block text-xs text-occ-muted">{note}</span>}
                  </span>
                </div>
              );
            })}
          </fieldset>
        ))}
      </div>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-keyshortcuts={key}
        title={open ? t('layers.hide') : t('layers.show')}
        onClick={() => setLayersMenuOpen(!open)}
        className={railToolClass(open)}
      >
        <span aria-hidden="true" className={RAIL_KEY}>{key}</span>
        {SHORTCUT[language] ?? SHORTCUT.es}
      </button>
    </div>
  );
}
