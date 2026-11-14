'use client';

import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react';
import * as maplibre from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../../../styles/occ-map.css';
import { useTranslation } from '../../../i18n/LanguageScope';
import { serverClock } from '../../../services/serverClock';
import { useOccBoot } from '../../admin-occ/boot/occBootContext';
import { createOccShortcutHandler } from '../../occ-ui/occShortcuts';
import { mapStandCode } from '../../positions-map/positionsMapMappers';
import { airfieldFeatures } from '../airport/airfieldFeatures';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { mapMessages } from '../mapMessages';
import { ghostFeatures, placedLocation, placingGhost } from '../stands/placing';
import {
  STAND_FEATURE_COLLECTIONS, boxOfPoints, boxesMeet, buildStandFeatures, diffStandFeatures, featuresIn, standSignalOf,
  standsDrawnIn,
} from '../stands/standFeatures';
import {
  featureStatePlan, findStandByCode, isOutsideSafeArea, sameAgentMark, standFlags, standTooltip,
} from '../stands/standInteractions';
import { STAND_GHOST_SOURCE, STAND_SOURCE, STAND_SOURCES, standDisplayAt, standOverlay } from '../stands/standLayers';
import { attachStandGeometry, standStateOf } from '../stands/standModel';
import {
  AIRFIELD_LAYER_IDS, AIRFIELD_SOURCE, airfieldKindsOnScreen, airfieldOverlay, airfieldTooltip,
} from '../style/airfieldLayers';
import { createImageResolver } from '../style/mapImages';
import { buildOccStyle } from '../style/occStyle';
import {
  NIGHT_SOURCE, REFERENCE_SOURCE, referenceFeatures, referenceLayersShown, referenceOverlay,
} from '../style/referenceLayers';
import { SELECTION_SOURCE, selectionFeatures, selectionOverlay } from '../style/selectionLayers';
import { FLIGHT_SOURCE, flightOverlay, flightsInView, toFlightFeatures } from '../traffic/flightLayers';
import { nightShadeFeatures } from '../traffic/nightShade';
import { counterpartCodes, mapRunwayInUse, referencesOnScreen as referencesOnScreenOf } from '../traffic/referenceFeatures';
import { trailsBesideRoute } from '../traffic/routeFeatures';
import {
  ROUTE_SOURCE, TRAFFIC_SOURCE, TRAILS_SOURCE, featuresById, isEmptyDiff, onScreenKey, selectedAircraftId, trafficDiff,
  trafficFeatures, trafficOnScreen as trafficOnScreenOf,
} from '../traffic/trafficFeatures';
import { trafficOverlay } from '../traffic/trafficLayers';
import {
  SATELLITE_KEYS, SATELLITE_SOURCES, WIND_FEATURE_ID, WIND_LAYER_IDS, WIND_SOURCE, satelliteTiles, wantedImagery,
  weatherLayerNotes, weatherOnScreen, weatherOverlay, windFeatures, windTooltip, withPinnedImagery,
} from '../traffic/weatherLayers';
import MapTooltip from '../ui/MapTooltip';
import { remoteSatelliteImagery, useSatelliteImagery } from '../useSatelliteImagery';
import { buildAttribution } from './attribution';
import {
  VIEW_NAMES, boundsCenter, cameraAngles, fitZooms, isInBounds, isRetired, lngLatOf, presetForZoom, presetTargets,
  sameFits, standCodeOf, standsInView, targetFor, thresholdsFromFits, transitionFor, unionBounds,
} from './cameraPresets';
import {
  availableLayerKeys, cleanOverrides, engineGroupsFor, readLayerOverrides, resolveLayers, setLayerOverride,
  writeLayerOverrides,
} from './layersMenu';
import { createMapEngine } from './mapEngine';
import { matchFlight, relatedEntities } from './mapSelection';
import MapUnavailable from './MapUnavailable';
import { OccMapContext } from './OccMapContext';
import { useMapSelection } from './useMapSelection';
import { useMinuteClock } from './useMinuteClock';

// The one map component of the OCC (design A4). Client only: the pages load it through next/dynamic with ssr false.
// It owns one engine (core/mapEngine.js) for its whole life, the four views of contracts 2.3 with thresholds derived
// from the fitted zooms, the selection, the map keys of contracts 2.2 and the fallback list. DOM overlays come as
// children and reach the map through OccMapContext. It always draws the references (the ARP of PUJ) and, from the
// derived airfield threshold, the airfield of its airport layout (PR M3: the MDPC dataset unless `layout` says
// otherwise), whose box and stand polygons also frame the airport views; a runway or a taxiway under the pointer shows
// the map tooltip, and a click holds it. Given `stands` it draws them as polygons with their state (PR M4): where each
// one is comes from the layout or from the location OCC saved (stands/standModel.js: attachStandGeometry), how it
// reads from the display the screen derived (useStandDisplay) or its board status, and its countdowns follow the
// map's minute clock. A stand under the pointer shows its tooltip and, as the selected one does, marks the stands
// covered by the same agent; selecting a stand outside the area in sight eases the camera to it; and while a stand is
// placed («Ubicar en el mapa», design D5) its box follows the pointer and a click gives a pending location (all
// feature-state or one source of their own: stands/standInteractions.js, stands/placing.js). Given `flights` it draws
// those with a position. Their overlays are part of the style from the start, so the first data is one setData per
// source and every later change one updateData with what changed: the map is never re-created. A screen's own overlays
// get their data through `overlayData`. The references of PR M8 (range rings, extended centrelines with the runway in
// use, the region's airports, the navaids and the night) are part of every map: one setData when what they draw changes,
// and the night on the minute of the server's clock. A map given the weather (PR M8) also draws the wind at the airfield
// and, when a person asks, the satellite clouds and rain of NASA GIBS pinned to the time of their image.

const EMPTY = Object.freeze([]);
const NO_FLAGS = Object.freeze({ hover: null, selected: null, related: null, sameAgent: Object.freeze(new Set()) });
const NO_CODES = Object.freeze(new Set());
const NO_GROUPS = Object.freeze({});
const INSET_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);
const SELECTABLE_KINDS = new Set(['stand', 'flight', 'aircraft']);
// What takes the pointer cursor: what can be selected, a terminal chip to open, and a runway, a taxiway or the wind (PR
// M8) with its tooltip.
const POINTER_KINDS = new Set([...SELECTABLE_KINDS, 'terminal', 'runway', 'taxiway', 'wind']);
// A map without stands has no countdown to keep: its clock stays still at this instant and starts no timer.
const NO_CLOCK = 0;
const PITCH_EASE_MS = 600;
const NORTH_EASE_MS = 400;
const BOUNDS_PADDING_PX = 70;
// flyToStand comes this close unless the caller asks for more: a step past the ramp fit, derived like the thresholds.
const STAND_FOCUS_OVER_RAMP = 1.5;

function normalizeInsets(insets) {
  return Object.fromEntries(INSET_SIDES.map(side => [side, Math.max(0, Number(insets?.[side]) || 0)]));
}

const insetsKey = insets => INSET_SIDES.map(side => insets[side]).join('|');
const insetsFromKey = key => Object.fromEntries(key.split('|').map((value, index) => [INSET_SIDES[index], Number(value)]));
const insetVariables = insets => Object.fromEntries(INSET_SIDES.map(side => [`--occ-map-inset-${side}`, `${insets[side]}px`]));
const addPadding = (insets, extra) => Object.fromEntries(INSET_SIDES.map(side => [side, insets[side] + extra]));
const viewKey = (view, terminal) => `${view}:${terminal ?? ''}`;
// What the legend reads of a stand on screen: its state, the signal the map draws on it and where its location comes
// from.
const standsKey = stands => stands
  .map(stand => [standCodeOf(stand), standStateOf(stand), standSignalOf(stand) ?? '', stand.locationSource ?? ''].join(':'))
  .join('|');
const sameList = (first, second) => first.join('|') === second.join('|');
// The legend shows one entry for every drawn flight, so which flights are on screen is all that counts.
const flightsKey = flights => flights.map(flight => String(flight.id)).join('|');
// Thresholds for a map without the airfield overlay: the tile aeroway then keeps every zoom.
const withoutAirfield = ({ airfield, ...rest }) => rest;
// The traffic (PR M5): nothing on screen, an empty source, and the key of a traffic source's credit.
const NO_TRAFFIC_ON_SCREEN = Object.freeze({ kinds: EMPTY, tags: EMPTY, trails: EMPTY, route: EMPTY });
// The references (PR M8): nothing on screen, and what the legend reads of what is (with the weather: the time of each
// satellite image on screen).
const NO_REFERENCES_ON_SCREEN = Object.freeze({ kinds: EMPTY, runway: null });
const imageryKey = imagery => Object.entries(imagery ?? {}).map(([key, image]) => `${key}@${image.time}`).join(',');
const referencesKey = ({ kinds, runway, imagery }) => `${kinds.join('|')}#${runway ? `${runway.arrival}:${runway.source}` : ''}`
  + `#${imageryKey(imagery)}`;
// The weather (PR M8): no note under a key of the layers menu.
const NO_NOTES = Object.freeze({});
const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: EMPTY });
const creditKeyOf = source => (source && typeof source.name === 'string' && source.name.trim() !== ''
  ? JSON.stringify([source.name, source.homeUrl ?? null, source.licenseName ?? null, source.licenseUrl ?? null])
  : '');
// Where the layers menu keeps a browser's choices (core/layersMenu.js); a browser that refuses storage keeps none.
function layerStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Where the traffic draws the ELEVANT aircraft a flight id names (any id matchFlight reads), as `[lng, lat]`, or null.
function trafficPoint(traffic, id) {
  const aircraft = traffic?.aircraft ?? EMPTY;
  const chosen = selectedAircraftId(aircraft, { kind: 'flight', id });
  const item = chosen === null ? null : aircraft.find(entry => entry.id === chosen);
  return item ? [item.lon, item.lat] : null;
}

// Where the tooltip of the airfield sits: at the pixel it points at, on the side of the visible area's middle that has
// room for it, so the card stays inside the map.
function tooltipPlacement(engine, padding, point) {
  const bounds = engine.getVisibleBounds(padding);
  const middle = bounds === null ? null : engine.project(boundsCenter(bounds));
  return {
    x: point.x,
    y: point.y,
    alignX: middle !== null && point.x > middle.x ? 'end' : 'start',
    alignY: middle !== null && point.y > middle.y ? 'end' : 'start',
  };
}

// Where the tooltip of a stand sits: under the stand's box on screen (its polygon's pixels), or over it when the stand
// is in the lower half of the visible area, starting at the box's outer side and running towards the middle. A stand's
// label is centred on its box and may be wider than it, so the card never covers the stand or its label. `null`
// without a polygon, or when the box takes more than half the height in sight (the card then follows the pointer).
function standTooltipPlacement(engine, padding, polygon) {
  const points = (Array.isArray(polygon) ? polygon : []).map(point => engine.project(point)).filter(Boolean);
  const bounds = engine.getVisibleBounds(padding);
  if (points.length === 0 || bounds === null) return null;
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const corners = [bounds[0], bounds[1]].map(corner => engine.project(corner)).filter(Boolean);
  const middle = engine.project(boundsCenter(bounds));
  if (corners.length < 2 || !middle || bottom - top > Math.abs(corners[0].y - corners[1].y) / 2) return null;
  const toRight = (left + right) / 2 > middle.x;
  const above = (top + bottom) / 2 > middle.y;
  return { x: toRight ? right : left, y: above ? top : bottom, alignX: toRight ? 'end' : 'start', alignY: above ? 'end' : 'start' };
}

// Whether the map has drawn everything it was given, on its root: `false` from a camera move or a data write until the
// next frame MapLibre draws with nothing left to load, place or fade (its `idle`), then `true`. Written straight to the
// DOM, without a render: the visual suite waits on it before a screenshot of a screen that exposes no handle.
const markSettled = (root, settled) => root?.setAttribute('data-occ-settled', settled ? 'true' : 'false');

const requestFrame = callback => (typeof globalThis.requestAnimationFrame === 'function'
  ? globalThis.requestAnimationFrame(callback)
  : globalThis.setTimeout(callback, 16));
const cancelFrame = handle => (typeof globalThis.cancelAnimationFrame === 'function'
  ? globalThis.cancelAnimationFrame(handle)
  : globalThis.clearTimeout(handle));

const initialSnapshot = basemap => ({
  engineStatus: 'starting',
  basemapStatus: basemap ? 'loading' : 'off',
  activeView: null,
  fits: null,
  thresholds: null,
  standsOnScreen: EMPTY,
  chipsOnScreen: EMPTY,
  standMarksOnScreen: EMPTY,
  flightsOnScreen: EMPTY,
  airfieldOnScreen: EMPTY,
  // The map tooltip of a runway or a taxiway: what it shows, where, and whether a click holds it.
  tooltip: null,
  // The traffic drawn in the area the insets leave in sight (PR M5): its kinds, tags and trails.
  trafficOnScreen: NO_TRAFFIC_ON_SCREEN,
  // The keys of the layers menu this map's style has layers for (PR M5, core/layersMenu.js).
  layerKeys: EMPTY,
  // The references drawn in that area (PR M8): their legend kinds and the runway in use.
  referencesOnScreen: NO_REFERENCES_ON_SCREEN,
});

// What the engine reports, kept outside React state: an engine event is not a render, and the component subscribes
// with useSyncExternalStore, so it renders only when a value it shows changes (never per frame).
function createViewStore(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    get: () => snapshot,
    set(patch) {
      const changed = Object.entries(patch).filter(([key, value]) => !Object.is(snapshot[key], value));
      if (changed.length === 0) return;
      snapshot = { ...snapshot, ...Object.fromEntries(changed) };
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The words MapLibre puts on its canvas and controls, in the screen's language.
function engineLocale(t, mapLabel) {
  return {
    'Map.Title': mapLabel ?? t('map.label'),
    'NavigationControl.ZoomIn': t('controls.zoomIn'),
    'NavigationControl.ZoomOut': t('controls.zoomOut'),
    'NavigationControl.ResetBearing': t('controls.resetBearing'),
    'AttributionControl.ToggleAttribution': t('controls.attribution'),
    'ScaleControl.NauticalMiles': t('controls.nauticalMiles'),
  };
}

function findStand(stands, code) {
  const wanted = mapStandCode(code);
  return stands.find(stand => stand != null && !isRetired(stand) && mapStandCode(standCodeOf(stand)) === wanted) ?? null;
}

// Where a stand is: the centre of the box the map draws for it, else its own location.
const standPointOf = stand => stand?.geometry?.center ?? lngLatOf(stand);

/**
 * Props:
 * - `defaultView` ('ramp'), `layout` (the airport layout the map draws its airfield from and frames the airport views
 *   with: the MDPC dataset by default; `null` draws no airfield of its own, keeps the tile aeroway at every zoom and
 *   frames the views with the stand points; the airfield it draws is the one given at start, the views follow the
 *   prop), `presetStands` (the stands that frame the views without a layout; `stands` when absent), `stands` (the
 *   stands of the screen, with `status` and, when the screen derived it, `displayStatus`, `signals` and `display`
 *   (useStandDisplay); given at start, the map draws them as polygons, with `standLabels` 'default' or 'dashboard'),
 *   `frozenAt` (milliseconds: the instant the stand countdowns are counted at, the map lab's frozen clock; without it
 *   the minute clock runs), `flights` (given at start, the map draws those with a position);
 * - `overlays` for buildOccStyle and `basemap`, `interactive` and `mapOptions` (extra MapLibre options, such as the
 *   map lab's `fadeDuration: 0`; the map keeps its own locale): read once, when the map starts, as are whether
 *   `stands` and `flights` are given and `standLabels`;
 * - `overlayData` (`{ [sourceId]: FeatureCollection }`): the data of the sources of `overlays`, one setData for each
 *   source whose features change, as for the stands and the flights;
 * - `selection` (`{ kind, id }` or null) and `onSelect({ kind, id } | null)`; a selected stand outside the area in
 *   sight brings the camera to it at the same zoom (never the stand flyToStand was just asked for); a click on a
 *   terminal chip opens that terminal's view; `onPick(hit)` for a click on anything else a layer lets pick
 *   (`{ kind, id, feature }` as the engine answers it: not a stand, a flight, an aircraft, a terminal, a runway or a
 *   taxiway); `initialCamera` and `onCameraChange(camera)`;
 * - placing a stand (ADR-0027): `placing` (a crosshair, and a click gives `onMapClick({ latitude, longitude })`), or
 *   `placingStand` (`{ code, sizeHint }`: also the stand's box at the pointer, and the click gives
 *   `onMapClick({ latitude, longitude, snapped })`, the layout's centre when the box snapped to it), `pendingLocation`
 *   (`{ latitude, longitude }`, the pending box) and `onCancelPlacing()`, which Esc calls before it would clear the
 *   selection;
 * - `pitchMode` ('2d' | '3d'), `groups` ({ 'buildings-3d': true }), `insets` ({ top, right, bottom, left } in px);
 * - `testId` of the host that holds the canvas, `labels` ({ unavailableTitle, unavailableDescription,
 *   unavailableList, map }), `fallbackItems` ([{ id, label, kind }]) and `onFallbackSelect(id, item)`;
 * - `isShortcutBlocked()` (an open drawer that is not a modal dialog), `className`, `children` (DOM overlays).
 * - `traffic` (PR M5): `{ aircraft, trails, route, source, flights }` from the map situation (useMapSituation: the
 *   aircraft of traffic/situationModel.js, the trails FeatureCollection, the chosen flight's route, the air picture's
 *   source and, from PR M8, the rows of the map flights, whose counterparts the references emphasise).
 *   Whether it is given is read at start, as for the stands and the flights: the map then draws the traffic overlay,
 *   one updateData per change of the aircraft (a selection, the aircraft under the pointer and the shown groups
 *   included), lists the traffic on screen for the legend, and credits the source in the attribution while traffic
 *   is on screen. The chosen aircraft is drawn larger in cyan with the selection ring, both layers of the traffic
 *   overlay in the selection slot (traffic/trafficLayers.js), so they move in the aircraft's own updateData and the
 *   selection source keeps the stands and the flights; while its route shows, its trail gives way to the route's flown
 *   part.
 * - The layers menu (PR M5, core/layersMenu.js, ui/MapLayersMenu.jsx): the map keeps the person's choices (only what
 *   differs from the defaults of the view on screen, in `localStorage`) and shows or hides the groups they name, except
 *   a group the page sets in `groups`, which wins. The menu reads them from OccMapContext; L opens and closes a menu on
 *   screen and Esc closes an open one before it clears the selection.
 * - The references (PR M8, style/referenceLayers.js): `weather` (what useMdpcWeather answers, or null) gives the wind of
 *   a live METAR for the runway in use, after the recent live arrivals of `traffic` and before the usual 08 (contracts
 *   2.3); `traffic.flights` the counterparts of today's flights. The reference source is written again only when the
 *   runway in use, the counterparts or the language change, and the night shade on the minute of the server's clock
 *   (`frozenAt` holds it in the map lab). The legend lists the references on screen, read back from the map.
 * - The weather (PR M8, traffic/weatherLayers.js). Whether `weather` is given (null while there is no reading) is read at
 *   start, as for the traffic: the map then draws the wind of its METAR at the airfield, written again only when what it
 *   draws changes, with its tooltip and, while it is on screen, the credit «Clima: NOAA Aviation Weather Center»; and
 *   the satellite clouds and rain of NASA GIBS, read (useSatelliteImagery, through `satelliteService`, by default the
 *   browser's) only while the layers menu shows one and the map is in Región or Aproximación, and shown only once its
 *   tiles are pinned to the time GIBS reports. `layerOverrides` (read once, at start) replaces the choices kept in the
 *   browser, which then stay as they are: the scenes of the map lab open with their own layers.
 */
const OccMap = forwardRef(function OccMap({
  defaultView = 'ramp',
  layout = MDPC_LAYOUT,
  presetStands,
  stands: standsProp,
  standLabels = 'default',
  frozenAt = null,
  flights: flightsProp,
  traffic,
  weather,
  satelliteService = remoteSatelliteImagery,
  layerOverrides: layerOverridesProp,
  overlays = EMPTY,
  overlayData,
  selection = null,
  onSelect,
  onPick,
  onMapClick,
  placing = false,
  placingStand = null,
  pendingLocation = null,
  onCancelPlacing,
  initialCamera,
  onCameraChange,
  pitchMode = '2d',
  groups = NO_GROUPS,
  insets,
  interactive = true,
  basemap = true,
  mapOptions,
  testId = 'occ-map-host',
  labels,
  fallbackItems,
  onFallbackSelect,
  isShortcutBlocked,
  className = '',
  children,
}, ref) {
  const { t, language } = useTranslation(mapMessages);
  const { markReady } = useOccBoot();
  const { view: urlView, terminal: urlTerminal, setView } = useMapSelection();
  const [store] = useState(() => createViewStore(initialSnapshot(basemap)));
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  const stands = standsProp ?? EMPTY;
  const flights = flightsProp ?? EMPTY;
  // Where each stand is drawn, and what the stand layers draw at the map's minute: the countdowns change on the
  // minute, and a re-read of the same positions builds the same features.
  const attached = useMemo(() => attachStandGeometry(stands, layout), [stands, layout]);
  const clock = useMinuteClock({ frozenAt: standsProp === undefined ? NO_CLOCK : frozenAt });
  const standFeatures = useMemo(() => buildStandFeatures(attached, { nowMs: clock, language, labels: standLabels }),
    [attached, clock, language, standLabels]);
  // The references (PR M8): the runway in use from the recent live arrivals of the traffic, then the wind of a live
  // METAR (no older than the API's live limit at the server's minute), then the usual 08; the counterparts of today's
  // flights; and the night shade at the server's minute (the map lab's frozen instant when it has one). The reference
  // features are built again only when the runway in use, the counterparts or the language change.
  const referenceMinute = useMinuteClock({ frozenAt, clock: serverClock });
  const referenceAircraft = traffic?.aircraft ?? EMPTY;
  // The weather (PR M8): whether the map draws it is read at start; a map without it still takes no wind for the runway.
  const [drawsWeather] = useState(() => weather !== undefined);
  const weatherNow = weather ?? null;
  const runway = useMemo(() => mapRunwayInUse({ layout, aircraft: referenceAircraft, weather: weatherNow,
    nowMs: referenceMinute }), [layout, referenceAircraft, weatherNow, referenceMinute]);
  const { arrival: runwayArrival, departure: runwayDeparture, source: runwaySource } = runway;
  const counterpartsKey = counterpartCodes(traffic?.flights).join('|');
  const referenceData = useMemo(() => referenceFeatures({
    layout,
    runway: { arrival: runwayArrival, departure: runwayDeparture, source: runwaySource },
    counterparts: counterpartsKey === '' ? EMPTY : counterpartsKey.split('|'),
    language,
  }), [layout, runwayArrival, runwayDeparture, runwaySource, counterpartsKey, language]);
  const nightWord = t('reference.night');
  const nightData = useMemo(() => nightShadeFeatures(referenceMinute, { label: nightWord }), [referenceMinute, nightWord]);
  // The wind at the airfield (PR M8), from the METAR of the weather with the runway in use, at the server's minute (a
  // live METAR kept after failed refreshes ages into a stale one).
  const windData = useMemo(() => windFeatures({ reading: weatherNow, runway: runwayArrival, layout, language,
    nowMs: referenceMinute }), [weatherNow, runwayArrival, layout, language, referenceMinute]);

  const paddingKey = insetsKey(normalizeInsets(insets));
  const padding = useMemo(() => insetsFromKey(paddingKey), [paddingKey]);
  const referenceStands = presetStands ?? stands;
  const targets = useMemo(() => presetTargets({ stands: referenceStands, layout }), [referenceStands, layout]);
  const groupsKey = JSON.stringify(groups ?? NO_GROUPS);

  // The layers menu (PR M5, core/layersMenu.js): the person's choices, read from the browser once, resolved for the
  // view on screen. The groups they show join the page's own `groups`, which win for a group the page sets itself.
  const [layerOverrides, setLayerOverrides] = useState(() => (layerOverridesProp === undefined
    ? readLayerOverrides(layerStorage())
    : cleanOverrides(layerOverridesProp)));
  // Choices a page gives (the map lab's scenes, PR M8) are not the browser's: they are never written back.
  const [keepsLayers] = useState(() => layerOverridesProp === undefined);
  const [layersMenuOpen, setLayersMenuOpenState] = useState(false);
  const layersMenusRef = useRef(0);
  const setLayersMenuOpen = useCallback(open => setLayersMenuOpenState(open === true), []);
  // A menu on screen registers itself: L opens one only while one is there, and the last one to go closes it.
  const registerLayersMenu = useCallback(() => {
    layersMenusRef.current += 1;
    return () => {
      layersMenusRef.current -= 1;
      if (layersMenusRef.current === 0) setLayersMenuOpenState(false);
    };
  }, []);
  const layerView = snapshot.activeView ?? defaultView;
  const resolvedLayers = useMemo(() => resolveLayers(layerView, layerOverrides), [layerView, layerOverrides]);
  const menuGroups = useMemo(() => engineGroupsFor(resolvedLayers), [resolvedLayers]);
  // The satellite images (PR M8): read only while the menu shows one and the map is in Región or Aproximación, and
  // shown only once their tiles are pinned to the time GIBS reports.
  const wanted = wantedImagery({ groups: menuGroups, view: layerView, drawsWeather });
  const imagery = useSatelliteImagery({ goes: wanted.goes, imerg: wanted.imerg, service: satelliteService });
  const menuGroupsKey = JSON.stringify(withPinnedImagery(menuGroups, imagery));
  const shownGroups = useMemo(() => ({ ...JSON.parse(menuGroupsKey), ...JSON.parse(groupsKey) }),
    [menuGroupsKey, groupsKey]);
  const shownGroupsKey = JSON.stringify(shownGroups);
  // The trails and the chosen flight's route (PR M5): while the route shows, the chosen aircraft's trail gives way to
  // its flown part, so it is drawn once, in the selection's cyan.
  const trafficTrails = traffic?.trails ?? null;
  const trafficRoute = traffic?.route ?? null;
  const routeShown = shownGroups.route !== false;
  const shownTrails = useMemo(() => (routeShown ? trailsBesideRoute(trafficTrails, trafficRoute) : trafficTrails),
    [routeShown, trafficTrails, trafficRoute]);

  const rootRef = useRef(null);
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const latest = useRef(null);
  const lastViewRef = useRef(null);
  // A view that could not be framed yet because the map has no size (a hidden or collapsed container): it is framed,
  // without animation, as soon as the map has room.
  const pendingViewRef = useRef(null);
  // What the current engine was given or drew last; reset whenever an engine starts.
  const appliedRef = useRef({ padding: null, pitchMode: null, groups: null, selection: null });
  const pointerRef = useRef({ event: null, frame: 0 });
  // The stand flyToStand was last asked for: when the selection then comes to it, the camera is already on its way.
  const focusRef = useRef(null);
  const placingNow = placing || placingStand !== null;

  // The newest props for engine callbacks and imperative calls; assigned after each render, never during it.
  useLayoutEffect(() => {
    latest.current = {
      stands, attached, standFeatures, presetStands: presetStands ?? EMPTY, flights, selection, onSelect, onPick,
      onMapClick, placing: placingNow, placingStand, onCancelPlacing, onCameraChange, isShortcutBlocked, pitchMode,
      padding, targets, urlView, urlTerminal, defaultView, initialCamera, basemap, overlays, interactive, mapOptions,
      layout, t, language,
      locale: engineLocale(t, labels?.map),
      aircraftDataLabel: t('attribution.aircraftData'),
      drawsStands: standsProp !== undefined, drawsFlights: flightsProp !== undefined, standLabels,
    };
    // The traffic (PR M5): what it draws, the groups the map shows (the page's and the layers menu's), the words of its
    // tags, the trails it draws beside the chosen flight's route, and the layers menu the map keys open and close.
    Object.assign(latest.current, { traffic: traffic ?? null, drawsTraffic: traffic !== undefined, groups: shownGroups,
      language, shownTrails, layersMenuOpen, setLayersMenuOpen });
    // The weather (PR M8): whether the map draws it, the satellite images and the wind it draws.
    Object.assign(latest.current, { drawsWeather, imagery, windData });
  });

  // A choice of the layers menu: a difference from the defaults of the view on screen, kept in the browser.
  const setLayer = useCallback((key, on) => {
    const view = store.get().activeView ?? latest.current?.defaultView ?? null;
    setLayerOverrides(current => setLayerOverride(current, view, key, on));
  }, [store]);
  const writtenLayersRef = useRef(layerOverrides);
  useEffect(() => {
    if (writtenLayersRef.current === layerOverrides) return;
    writtenLayersRef.current = layerOverrides;
    if (keepsLayers) writeLayerOverrides(layerStorage(), layerOverrides);
  }, [layerOverrides, keepsLayers]);

  // The camera that frames `bounds` in the area the insets leave free, plus `extra` pixels on every side.
  const cameraFor = useCallback((bounds, extra = 0) => {
    const engine = engineRef.current;
    if (!engine?.map || !bounds) return null;
    const current = latest.current.padding;
    const camera = engine.cameraForBounds(bounds, {
      padding: extra > 0 ? addPadding(current, extra) : current, absolutePadding: true, bearing: 0,
    });
    return Number.isFinite(camera?.zoom) ? { center: camera.center, zoom: camera.zoom, padding: current } : null;
  }, []);

  const moveCamera = useCallback((camera, { animate = true } = {}) => {
    const engine = engineRef.current;
    if (!engine?.map) return;
    if (!animate) {
      engine.jumpTo(camera);
      return;
    }
    const { method, ...transition } = transitionFor(engine.getCamera()?.zoom, camera.zoom);
    engine[method]({ ...camera, ...transition });
  }, []);

  const applyView = useCallback((view, { terminal = null, animate = true } = {}) => {
    // Another view closes the map tooltip, held or not.
    store.set({ tooltip: null });
    const target = targetFor(latest.current.targets, view, terminal);
    const camera = cameraFor(target?.bounds);
    if (!camera) {
      if (target && engineRef.current?.map) pendingViewRef.current = { view, terminal };
      return false;
    }
    pendingViewRef.current = null;
    moveCamera({ ...camera, ...cameraAngles(view, latest.current.pitchMode) }, { animate });
    return true;
  }, [cameraFor, moveCamera, store]);

  const flyToPreset = useCallback((view, { terminal = null } = {}) => applyView(view, { terminal }), [applyView]);

  // A view asked for by a person: fly now (also to the view already in the URL after a free zoom) and write `view=`.
  const requestView = useCallback((view, { terminal = null } = {}) => {
    if (!VIEW_NAMES.includes(view)) return;
    const viewTerminal = view === 'ramp' ? terminal : null;
    lastViewRef.current = viewKey(view, viewTerminal);
    applyView(view, { terminal: viewTerminal });
    setView(view, { terminal: viewTerminal });
  }, [applyView, setView]);

  const flyToStand = useCallback((code, { minZoom } = {}) => {
    const engine = engineRef.current;
    const { attached: drawn, presetStands: reference, padding: inset } = latest.current ?? {};
    const point = standPointOf(findStand([...(drawn ?? EMPTY), ...(reference ?? EMPTY)], code));
    const camera = engine?.getCamera();
    if (!point || !camera) return false;
    const fits = store.get().fits;
    const focus = Number.isFinite(minZoom) ? minZoom : fits ? fits.ramp + STAND_FOCUS_OVER_RAMP : camera.zoom;
    focusRef.current = mapStandCode(code) || null;
    moveCamera({ center: point, zoom: Math.max(camera.zoom, focus), padding: inset });
    return true;
  }, [moveCamera, store]);

  // Centres a flight that has a position (by any id matchFlight reads), keeping the zoom unless `minZoom` asks for more.
  const flyToFlight = useCallback((id, { minZoom } = {}) => {
    const engine = engineRef.current;
    const { flights: current, padding: inset } = latest.current ?? {};
    const flight = matchFlight(current ?? EMPTY, id);
    // A flight the traffic draws (PR M5) is where its aircraft is.
    const point = lngLatOf(flight?.position ?? flight) ?? trafficPoint(latest.current?.traffic, id);
    const camera = engine?.getCamera();
    if (!point || !camera) return false;
    const zoom = Number.isFinite(minZoom) ? Math.max(camera.zoom, minZoom) : camera.zoom;
    moveCamera({ center: point, zoom, padding: inset });
    return true;
  }, [moveCamera]);

  // Frames `[[lng, lat], …]` with `padding` pixels to spare inside the insets.
  const flyToBounds = useCallback((coords, { padding: extra = BOUNDS_PADDING_PX } = {}) => {
    const boxes = (Array.isArray(coords) ? coords : [])
      .map(point => lngLatOf({ longitude: point?.[0], latitude: point?.[1] }))
      .filter(Boolean)
      .map(point => [point, point]);
    const camera = cameraFor(unionBounds(...boxes), extra);
    if (!camera) return false;
    const view = presetForZoom(camera.zoom, store.get().fits) ?? 'ramp';
    moveCamera({ ...camera, ...cameraAngles(view, latest.current.pitchMode) });
    return true;
  }, [cameraFor, moveCamera, store]);

  const flyToAll = useCallback(() => applyView('ramp'), [applyView]);
  const flyToPuj = useCallback(() => applyView('airfield'), [applyView]);
  const resetNorth = useCallback(() => {
    engineRef.current?.easeTo({ bearing: 0, duration: NORTH_EASE_MS, essential: false });
  }, []);
  const getCamera = useCallback(() => engineRef.current?.getCamera() ?? null, []);
  // Puts the camera at once at `{ center, zoom, bearing, pitch }` (any of them), without a move a person sees: the map
  // lab and the visual suite set a zoom between two thresholds with it. False without a map.
  const jumpTo = useCallback(camera => {
    if (!engineRef.current?.map) return false;
    engineRef.current.jumpTo(camera);
    return true;
  }, []);
  // The pixel of `[lng, lat]` inside the map, as `{ x, y }` from its top-left corner, or null without a map (the
  // visual suite clicks a stand where the map draws it).
  const project = useCallback(lngLat => {
    const point = engineRef.current?.project(lngLat);
    return point ? { x: point.x, y: point.y } : null;
  }, []);
  // Resolves true once the map has drawn a frame with nothing left to load or move, false without a map.
  const whenIdle = useCallback(() => engineRef.current?.whenIdle() ?? Promise.resolve(false), []);

  // The traffic (PR M5). The aircraft of other traffic under the pointer, whose tag shows while it is there.
  const trafficFocusRef = useRef(null);

  // The traffic's features from the newest props: one updateData with what changed since the last write.
  const writeTraffic = useCallback(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsTraffic) return;
    const { traffic: current, selection: chosen, groups: shown, language: words } = latest.current;
    const data = trafficFeatures(current?.aircraft ?? EMPTY, {
      selection: chosen, focusId: trafficFocusRef.current, labelsOn: shown?.['traffic.labels'] === true, language: words,
    });
    const diff = trafficDiff(applied.trafficById, data.features);
    if (isEmptyDiff(diff)) return;
    applied.trafficById = featuresById(data);
    engine.updateData(TRAFFIC_SOURCE, diff).catch(error => console.error('The OCC map could not update its traffic.', error));
  }, []);

  // The traffic drawn in `bounds` (the area the insets leave in sight), for the legend and the credit.
  const updateTrafficOnScreen = useCallback((bounds, zoom, thresholds) => {
    const current = latest.current?.traffic;
    const next = appliedRef.current.drawsTraffic && bounds !== null
      ? trafficOnScreenOf(current?.aircraft ?? EMPTY, bounds, {
        groups: latest.current.groups, zoom, thresholds, trails: latest.current.shownTrails ?? null,
        route: current?.route ?? null,
      })
      : NO_TRAFFIC_ON_SCREEN;
    if (onScreenKey(next) !== onScreenKey(store.get().trafficOnScreen)) store.set({ trafficOnScreen: next });
  }, [store]);

  // What is drawn in the area the insets leave in sight (the page's panels hide what lies under them), for the legend,
  // which explains only what is on screen (contracts 2.4): the stands whose polygon reaches into that area from the
  // polygon threshold on, the terminal chips drawn there below it with the arrow over a chip whose terminal has a stand
  // in «Llegando», the combined links, narrow-body boxes and same-agent rings drawn there, the flights drawn there and
  // the airfield items drawn there. The stands and the chips are known from their own geometry; the airfield is read
  // back from the map from its threshold on, and right after a move the tiles of the new zoom may still be loading, so
  // it is read again when the map settles (onIdle). They change only when the camera, the insets, the thresholds, the
  // stands, the flights or what the map draws do, and a list keeps its identity while what the legend reads of it stays
  // the same.
  const updateOnScreen = useCallback(() => {
    const engine = engineRef.current;
    const { padding, attached: drawnStands, standFeatures: features } = latest.current;
    const bounds = engine?.getVisibleBounds(padding) ?? null;
    const { drawsStands, drawsFlights, drawsAirfield } = appliedRef.current;
    const zoom = engine?.getCamera()?.zoom;
    const { thresholds } = store.get();
    const display = bounds === null || !drawsStands ? 'hidden' : standDisplayAt(zoom, thresholds);
    const polygons = display === 'polygons';
    const next = polygons ? standsDrawnIn(drawnStands, bounds) : EMPTY;
    const chipsInSight = display === 'chips' ? featuresIn(features.groups, bounds) : EMPTY;
    const chips = chipsInSight.map(chip => chip.id);
    // The narrow-body boxes are drawn from the codes threshold on, the combined links with the polygons.
    const codesShown = !Number.isFinite(thresholds?.codes) || zoom >= thresholds.codes;
    const drawsAux = (kind, from) => from && featuresIn(features.aux, bounds, { kind }).length > 0;
    // The ring of the same agent is explained from what the feature-state draws (applyStandFlags): while it rings a
    // polygon in sight, with whose agent it follows, the stand under the pointer or the selected one (sameAgentMark). A
    // stand under the pointer without an agent rings nothing, so nothing is explained. The placing boxes at every
    // zoom, while they are in sight.
    const { standFlags: flags = NO_FLAGS, ghost, pendingGhost } = appliedRef.current;
    const ringMark = sameAgentMark(flags);
    const ringed = ringMark === null ? NO_CODES : new Set(flags.sameAgent);
    const ringInSight = polygons && ringMark !== null
      && standsDrawnIn(drawnStands.filter(stand => ringed.has(mapStandCode(standCodeOf(stand)))), bounds).length > 0;
    const boxInSight = box => bounds !== null && Array.isArray(box?.polygon) && boxesMeet(boxOfPoints(box.polygon), bounds);
    const marks = [
      // The arrow over a chip is drawn with the chips (stands/standLayers.js: occ-stand-groups-arriving).
      ...(chipsInSight.some(chip => chip.properties?.arriving === true) ? ['chipArriving'] : []),
      ...(drawsAux('combinedLink', polygons) ? ['combined'] : []),
      ...(drawsAux('narrowInner', polygons && codesShown) ? ['narrowbody'] : []),
      ...(ringInSight ? [ringMark] : []),
      ...(boxInSight(ghost) ? ['ghost'] : []),
      ...(boxInSight(pendingGhost) ? ['pending'] : []),
    ];
    // Only a map that started with flights draws them.
    const flights = bounds === null || !drawsFlights ? EMPTY : flightsInView(latest.current.flights, bounds);
    // Below its threshold the airfield is not drawn: nothing to ask the map.
    const airfieldDrawn = drawsAirfield && bounds !== null && !(zoom < thresholds?.airfield);
    const airfield = airfieldDrawn ? airfieldKindsOnScreen(engine.renderedFeatures(AIRFIELD_LAYER_IDS, padding)) : EMPTY;
    // The references drawn there (PR M8), read back from the map as the airfield is, for the groups that are shown.
    const referenceIds = bounds === null ? EMPTY : referenceLayersShown(latest.current.groups);
    const references = referenceIds.length === 0
      ? NO_REFERENCES_ON_SCREEN
      : referencesOnScreenOf(engine.renderedFeatures(referenceIds, padding));
    // The weather drawn there (PR M8): the wind, read back from the map; a satellite image while its group is shown
    // (once pinned) below the airfield threshold, as a raster is not read back. Listed after the references.
    const { groups: shown, imagery: images } = latest.current;
    const weatherShown = appliedRef.current.drawsWeather && bounds !== null ? weatherOnScreen({
      wind: shown?.['weather.wind'] === false ? EMPTY : engine.renderedFeatures(WIND_LAYER_IDS, padding),
      rasters: Object.fromEntries(SATELLITE_KEYS.map(key => [key,
        shown?.[`weather.${key}`] === true && !(zoom >= thresholds?.airfield)])),
      imagery: images,
    }) : null;
    const onScreen = weatherShown === null || weatherShown.kinds.length === 0
      ? references
      : { kinds: [...references.kinds, ...weatherShown.kinds], runway: references.runway, imagery: weatherShown.imagery };
    const previous = store.get();
    store.set({
      ...(standsKey(next) === standsKey(previous.standsOnScreen) ? {} : { standsOnScreen: next.length === 0 ? EMPTY : next }),
      ...(sameList(chips, previous.chipsOnScreen) ? {} : { chipsOnScreen: chips.length === 0 ? EMPTY : chips }),
      ...(sameList(marks, previous.standMarksOnScreen) ? {} : { standMarksOnScreen: marks.length === 0 ? EMPTY : marks }),
      ...(flightsKey(flights) === flightsKey(previous.flightsOnScreen)
        ? {}
        : { flightsOnScreen: flights.length === 0 ? EMPTY : flights }),
      ...(sameList(airfield, previous.airfieldOnScreen) ? {} : { airfieldOnScreen: airfield.length === 0 ? EMPTY : airfield }),
      ...(referencesKey(onScreen) === referencesKey(previous.referencesOnScreen)
        ? {}
        : { referencesOnScreen: onScreen.kinds.length === 0 ? NO_REFERENCES_ON_SCREEN : onScreen }),
    });
    updateTrafficOnScreen(bounds, zoom, thresholds);
  }, [store, updateTrafficOnScreen]);

  // The fitted zoom of each view in the room the insets leave; the thresholds follow them (contracts 2.3).
  const refit = useCallback(() => {
    const engine = engineRef.current;
    if (!engine?.map) return;
    const { padding: inset, targets: current } = latest.current;
    const fits = fitZooms((bounds, options) => engine.cameraForBounds(bounds, {
      ...options, padding: inset, absolutePadding: true,
    }), current);
    if (sameFits(fits, store.get().fits)) return;
    const thresholds = thresholdsFromFits(fits);
    // Without its own airfield the map leaves the tile aeroway at every zoom.
    if (thresholds) engine.applyThresholds(appliedRef.current.drawsAirfield ? thresholds : withoutAirfield(thresholds));
    store.set({ fits, thresholds, activeView: presetForZoom(engine.getCamera()?.zoom, fits) });
    // New thresholds may draw the stands on screen in another way (hidden, as chips or as polygons).
    updateOnScreen();
    const pending = pendingViewRef.current;
    if (fits && pending) applyView(pending.view, { terminal: pending.terminal, animate: false });
  }, [store, applyView, updateOnScreen]);

  // The map tooltip after a move: a card that follows the pointer goes with the move (the pointer shows the next one);
  // a held card moves with the point it was held at while that stays in sight, and closes when it leaves.
  const followTooltip = useCallback(() => {
    const tooltip = store.get().tooltip;
    if (tooltip === null) return;
    const engine = engineRef.current;
    const { padding } = latest.current;
    const bounds = tooltip.pinned ? engine?.getVisibleBounds(padding) ?? null : null;
    const point = bounds !== null && isInBounds(tooltip.lngLat, bounds) ? engine.project(tooltip.lngLat) : null;
    if (point === null) {
      store.set({ tooltip: null });
      return;
    }
    const placement = tooltipPlacement(engine, padding, point);
    if (Object.entries(placement).every(([key, value]) => tooltip[key] === value)) return;
    store.set({ tooltip: { ...tooltip, ...placement } });
  }, [store]);

  const handleCamera = useCallback((camera, details) => {
    if (!camera) return;
    // A person moved the map: a view still waiting for room is no longer wanted.
    if (details?.byUser) pendingViewRef.current = null;
    // The zoom is written straight to the DOM, without a render: the visual suite reads it to see the camera move.
    rootRef.current?.setAttribute('data-occ-zoom', camera.zoom.toFixed(2));
    markSettled(rootRef.current, false);
    store.set({ activeView: presetForZoom(camera.zoom, store.get().fits) });
    followTooltip();
    updateOnScreen();
    latest.current?.onCameraChange?.(camera, details);
  }, [store, followTooltip, updateOnScreen]);

  const handleStatus = useCallback(status => {
    store.set({ engineStatus: status.engine, basemapStatus: status.basemap });
  }, [store]);

  // Shows the tooltip of a runway, a taxiway or a stand picked at `point` (a pixel of the map) and `lngLat`: next to the
  // pointer, or beside the stand's box for a stand.
  const showTooltip = useCallback((info, point, lngLat, pinned) => {
    const engine = engineRef.current;
    if (!engine || !point || !lngLat) return;
    const { padding, attached: drawn } = latest.current;
    const polygon = info.kind === 'stand' ? findStandByCode(drawn, info.id)?.geometry?.polygon : null;
    const placement = standTooltipPlacement(engine, padding, polygon) ?? tooltipPlacement(engine, padding, point);
    store.set({ tooltip: { ...info, pinned, lngLat, ...placement } });
  }, [store]);

  // The tooltip of the stand `code` among the stands drawn now, in the screen's language (null when none is drawn).
  const standTooltipOf = useCallback(code => {
    const { attached: drawn, t: translate, language: words } = latest.current;
    return standTooltip(code, drawn, translate, words);
  }, []);

  // The tooltip of the wind (PR M8) a hit names: what the wind the map draws says now, in the screen's language, or null
  // for anything else.
  const windTooltipOf = useCallback(hit => {
    if (hit?.kind !== 'wind') return null;
    const { windData: data, language: words } = latest.current;
    const info = windTooltip(data?.features?.[0]?.properties, words);
    return info === null ? null : { kind: 'wind', id: WIND_FEATURE_ID, title: info.title, detail: info.detail,
      reasons: info.lines.map(text => ({ signal: null, text })) };
  }, []);

  // The wind's tooltip says what the wind says now: a new METAR, the runway in use or the language change its words, and
  // a wind that is no longer drawn closes it.
  const refreshWindTooltip = useCallback(() => {
    const tooltip = store.get().tooltip;
    if (tooltip?.kind !== 'wind') return;
    const info = windTooltipOf(tooltip);
    if (info === null) store.set({ tooltip: null });
    else if (JSON.stringify(info) !== JSON.stringify({ kind: tooltip.kind, id: tooltip.id, title: tooltip.title,
      detail: tooltip.detail, reasons: tooltip.reasons })) store.set({ tooltip: { ...tooltip, ...info } });
  }, [store, windTooltipOf]);

  // A stand's tooltip says what the stand says now: a board refresh, the minute or the language change its words, and a
  // stand that is no longer drawn closes it.
  const refreshStandTooltip = useCallback(() => {
    const tooltip = store.get().tooltip;
    if (tooltip?.kind !== 'stand') return;
    const info = standTooltipOf(tooltip.id);
    if (info === null) {
      store.set({ tooltip: null });
      return;
    }
    if (info.title === tooltip.title && info.detail === tooltip.detail
      && JSON.stringify(info.reasons) === JSON.stringify(tooltip.reasons)) return;
    store.set({ tooltip: { ...tooltip, ...info } });
  }, [store, standTooltipOf]);

  // The flags of the stand polygons (hover, selected, related, same agent), written as their feature-state: only what
  // changed (stands/standInteractions.js: featureStatePlan), so a pointer or a selection never rewrites the data. The
  // legend explains the same-agent ring the flags draw, and whose agent it follows: when the pointer or the selection
  // moves the ring, or makes it follow another stand, what is on screen is read again.
  const applyStandFlags = useCallback(next => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsStands) return;
    const previous = applied.standFlags ?? NO_FLAGS;
    const plan = featureStatePlan(previous, next);
    applied.standFlags = next;
    if (plan.length === 0) return;
    for (const step of plan) {
      if (step.op === 'remove') engine.removeFeatureState(STAND_SOURCE, step.id, step.key);
      else engine.setFeatureState(STAND_SOURCE, step.id, step.state);
    }
    markSettled(rootRef.current, false);
    const ringMoved = plan.some(step => step.key === 'sameAgent' || step.state?.sameAgent === true);
    if (ringMoved || sameAgentMark(previous) !== sameAgentMark(next)) updateOnScreen();
  }, [updateOnScreen]);

  // The stand under the pointer (`null` when there is none, or a drag), with the stands its agent covers.
  const hoverStand = useCallback(code => {
    const current = appliedRef.current.standFlags ?? NO_FLAGS;
    const hover = code == null ? null : mapStandCode(code) || null;
    if (hover === current.hover) return;
    applyStandFlags(standFlags({ hover, selected: current.selected, related: current.related, stands: latest.current.attached }));
  }, [applyStandFlags]);

  // The boxes of «Ubicar en el mapa» (the one at the pointer and the pending location): one setData of their own source
  // when they change, never one of the stand sources.
  const writeGhost = useCallback(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsStands) return;
    const data = ghostFeatures({ ghost: applied.ghost, pending: applied.pendingGhost });
    const key = JSON.stringify(data.features);
    if (applied.ghostKey === key) return;
    applied.ghostKey = key;
    engine.setData(STAND_GHOST_SOURCE, data);
    markSettled(rootRef.current, false);
  }, []);

  // The box of the stand being placed at the pointer of `event` (none when the pointer left the map); the legend hears
  // when it comes or goes.
  const moveGhost = useCallback(event => {
    const { placingStand: stand, layout: plan } = latest.current;
    const applied = appliedRef.current;
    const ghost = stand && event?.lngLat
      ? placingGhost({ code: stand.code, pointer: event.lngLat, layout: plan, sizeHint: stand.sizeHint })
      : null;
    const shown = (ghost !== null) !== (applied.ghost !== null);
    applied.ghost = ghost;
    writeGhost();
    if (shown) updateOnScreen();
  }, [writeGhost, updateOnScreen]);

  const handleClick = useCallback(({ point, lngLat, hit }) => {
    const props = latest.current;
    if (props.placing) {
      if (!lngLat) return;
      // The click gives the centre of the box at the pointer: the layout's centre when it snapped to the stand's outline.
      // Without a stand to place (`placing` alone) it gives the clicked point, as it always did.
      if (props.placingStand) {
        const ghost = placingGhost({
          code: props.placingStand.code, pointer: lngLat, layout: props.layout, sizeHint: props.placingStand.sizeHint,
        });
        props.onMapClick?.(placedLocation(ghost) ?? { latitude: lngLat[1], longitude: lngLat[0], snapped: false });
      } else props.onMapClick?.({ latitude: lngLat[1], longitude: lngLat[0] });
      return;
    }
    // A click on a runway or a taxiway holds its tooltip, so nothing depends on hovering alone; a click anywhere else
    // closes it (a stand's says what its drawer says). The wind's is held the same way (PR M8).
    const info = airfieldTooltip(hit) ?? windTooltipOf(hit);
    if (info !== null) {
      showTooltip(info, point, lngLat, true);
      return;
    }
    if (store.get().tooltip !== null) store.set({ tooltip: null });
    if (!hit || hit.id == null) return;
    // A terminal chip opens that terminal's view, as the view selector would.
    if (hit.kind === 'terminal') requestView('ramp', { terminal: String(hit.id) });
    else if (SELECTABLE_KINDS.has(hit.kind)) props.onSelect?.({ kind: hit.kind, id: String(hit.id) });
    // Anything else a screen's own layer lets pick (the graph nodes of the map lab's layout review) is the screen's.
    else props.onPick?.(hit);
  }, [store, showTooltip, requestView, windTooltipOf]);

  // The tooltip of what is under the pointer, unless a click holds one: written to the store only when the runway, the
  // taxiway or the stand under the pointer changes, never on every frame. A drag (a button held down) shows none.
  const hoverTooltip = useCallback((event, hit) => {
    const current = store.get().tooltip;
    if (current?.pinned) return;
    let info = null;
    // The wind's tooltip (PR M8) shows on the same terms as a runway's.
    if (event && !event.originalEvent?.buttons) {
      info = hit?.kind === 'stand' ? standTooltipOf(hit.id) : (windTooltipOf(hit) ?? airfieldTooltip(hit));
    }
    if (info === null) {
      if (current !== null) store.set({ tooltip: null });
      return;
    }
    if (current?.kind === info.kind && current.id === info.id) return;
    showTooltip(info, event.point, event.lngLat, false);
  }, [store, showTooltip, standTooltipOf, windTooltipOf]);

  // Other traffic shows its tag while the pointer is on it (contracts 2.4: tag on demand), written with updateData.
  const focusTraffic = useCallback(hit => {
    const next = hit?.kind === 'aircraft' ? hit.feature?.properties?.id ?? null : null;
    if (trafficFocusRef.current === next) return;
    trafficFocusRef.current = next;
    writeTraffic();
  }, [writeTraffic]);

  // The cursor, the hover tooltip, the hovered stand and the focused traffic follow what is under the pointer, picked
  // once per frame; while a stand is placed, its box follows the pointer instead.
  const handlePointer = useCallback(event => {
    const pointer = pointerRef.current;
    pointer.event = event;
    if (pointer.frame) return;
    pointer.frame = requestFrame(() => {
      pointer.frame = 0;
      const engine = engineRef.current;
      if (!engine) return;
      if (latest.current.placing) {
        engine.setCursor('crosshair');
        moveGhost(pointer.event);
        return;
      }
      const hit = pointer.event?.hit;
      // A pick the screen hears (onPick) is something to click as well.
      const clickable = hit && (POINTER_KINDS.has(hit.kind) || (hit.id != null && latest.current.onPick));
      engine.setCursor(clickable ? 'pointer' : '');
      hoverTooltip(pointer.event, hit);
      focusTraffic(pointer.event ? hit : null);
      const dragging = Boolean(pointer.event?.originalEvent?.buttons);
      hoverStand(hit?.kind === 'stand' && hit.id != null && !dragging ? String(hit.id) : null);
    });
  }, [hoverTooltip, focusTraffic, hoverStand, moveGhost]);

  // A stand selected outside the area in sight brings the camera to it at the same zoom, inside the insets
  // (stands/standInteractions.js: isOutsideSafeArea); one in sight leaves the camera where it is.
  const easeToStand = useCallback(code => {
    const engine = engineRef.current;
    const { attached: drawn, padding: inset } = latest.current;
    const geometry = findStandByCode(drawn, code)?.geometry;
    const camera = engine?.getCamera();
    if (!camera || !Array.isArray(geometry?.polygon)) return false;
    if (!isOutsideSafeArea(boxOfPoints(geometry.polygon), engine.getVisibleBounds(inset))) return false;
    moveCamera({ center: geometry.center, zoom: camera.zoom, padding: inset });
    return true;
  }, [moveCamera]);

  // One engine for the life of the component. A StrictMode remount destroys the first one before the second starts.
  useEffect(() => {
    const props = latest.current;
    const pointer = pointerRef.current;
    store.set(initialSnapshot(props.basemap));
    appliedRef.current = {
      padding: props.padding, pitchMode: props.pitchMode, groups: null, selection: null, standFeatures: null, flights: null,
      overlayData: {}, drawsStands: props.drawsStands, drawsFlights: props.drawsFlights, standLabels: props.standLabels,
      drawsAirfield: Boolean(props.layout),
      // The feature-state flags of the stands (the legend reads the same-agent ring from them) and the placing boxes;
      // the stand selected when the map starts is framed by the view, not eased to.
      standFlags: NO_FLAGS, ghost: null, pendingGhost: null, ghostKey: '[]', placingCode: null,
      easedFor: props.selection?.kind === 'stand' ? mapStandCode(props.selection.id) || null : null,
    };
    // The traffic of this engine: what its source holds, the trails and route written, and the credit shown.
    Object.assign(appliedRef.current, { drawsTraffic: props.drawsTraffic, trafficById: new Map(), trails: null, route: null,
      credit: '' });
    // The weather of this engine (PR M8): the wind written and the tiles each satellite image is pinned to.
    Object.assign(appliedRef.current, { drawsWeather: props.drawsWeather, wind: null, rasterTiles: {} });
    focusRef.current = null;
    pendingViewRef.current = null;
    // The URL view, else the camera the page kept, else the default view.
    const initialView = props.urlView ?? (props.initialCamera ? null : props.defaultView);
    const initialTerminal = props.urlView ? props.urlTerminal : null;
    const angles = cameraAngles(initialView ?? props.defaultView, props.pitchMode);
    // A view starts over its target, so a map that has no size yet waits there and not at MapLibre's [0, 0].
    const start = initialView === null
      ? { ...angles, ...props.initialCamera }
      : { ...angles, center: boundsCenter(targetFor(props.targets, initialView, initialTerminal)?.bounds) ?? undefined };

    // The airfield goes before the references: they share the airfield slot, and the mark of PUJ stays above the
    // pavement.
    const overlays = [
      selectionOverlay(),
      ...(props.layout ? [airfieldOverlay()] : []),
      referenceOverlay(),
      ...(props.drawsStands ? [standOverlay({ labels: props.standLabels })] : []),
      ...(props.drawsFlights ? [flightOverlay()] : []),
      ...(props.drawsTraffic ? [trafficOverlay()] : []),
      // The weather (PR M8): the satellite images under the references, the wind over the stands.
      ...(props.drawsWeather ? [weatherOverlay()] : []),
      ...props.overlays,
    ];
    // The keys of the layers menu this style has layers for (PR M5).
    store.set({ layerKeys: availableLayerKeys({ layers: overlays.flatMap(overlay => overlay.layers ?? []) }) });
    const engine = createMapEngine({
      maplibre,
      host: hostRef.current,
      style: buildOccStyle({ basemap: props.basemap, overlays }),
      camera: start,
      interactive: props.interactive,
      attribution: buildAttribution([], { aircraftDataLabel: props.aircraftDataLabel }),
      imageResolver: createImageResolver(),
      mapOptions: { ...props.mapOptions, locale: props.locale },
      onStatus: handleStatus,
      onCamera: handleCamera,
      // What the map draws is final once it settles: the legend reads it again then.
      onIdle: () => {
        updateOnScreen();
        markSettled(rootRef.current, true);
      },
      onResize: refit,
      onClick: handleClick,
      onPointerMove: handlePointer,
    });
    engineRef.current = engine;
    if (props.layout) engine.setData(AIRFIELD_SOURCE, airfieldFeatures(props.layout));
    engine.setInsets(props.padding);
    refit();
    lastViewRef.current = props.urlView === null ? null : viewKey(props.urlView, props.urlTerminal);
    if (initialView === null) handleCamera(engine.getCamera(), { byUser: false });
    else applyView(initialView, { terminal: initialTerminal, animate: false });
    if (props.placing) engine.setCursor('crosshair');

    return () => {
      if (pointer.frame) cancelFrame(pointer.frame);
      pointer.frame = 0;
      pointer.event = null;
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [store, applyView, handleCamera, handleClick, handlePointer, handleStatus, refit, updateOnScreen]);

  // The URL view: fly only when it differs from the last view applied, so a view this map asked for flies once.
  useEffect(() => {
    if (urlView === null) {
      lastViewRef.current = null;
      return;
    }
    const key = viewKey(urlView, urlTerminal);
    if (key === lastViewRef.current) return;
    lastViewRef.current = key;
    applyView(urlView, { terminal: urlTerminal });
  }, [urlView, urlTerminal, applyView]);

  // The insets: camera padding and control positions, new fits and thresholds, and what is left on screen.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || appliedRef.current.padding === padding) return;
    appliedRef.current.padding = padding;
    engine.setInsets(padding);
    refit();
    updateOnScreen();
  }, [padding, refit, updateOnScreen]);

  // New stands may change what frames the views and what is on screen.
  useEffect(() => {
    refit();
  }, [targets, refit]);

  // New stands or flights may change what is on screen: a flight that moves in or out of sight changes the legend, and
  // a stand's tooltip says what the stand says now.
  useEffect(() => {
    updateOnScreen();
    refreshStandTooltip();
  }, [attached, standFeatures, flights, updateOnScreen, refreshStandTooltip]);

  // The drawn stands: one setData per source when the map starts, then one updateData per source with only the
  // features that changed (a board refresh, a minute's countdowns), never a new map. A re-read of the same positions
  // writes nothing.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsStands || applied.standFeatures === standFeatures) return;
    const previous = applied.standFeatures;
    applied.standFeatures = standFeatures;
    if (previous === null) {
      for (const name of STAND_FEATURE_COLLECTIONS) engine.setData(STAND_SOURCES[name], standFeatures[name]);
      markSettled(rootRef.current, false);
      return;
    }
    const diff = diffStandFeatures(previous, standFeatures);
    if (diff !== null) markSettled(rootRef.current, false);
    for (const name of STAND_FEATURE_COLLECTIONS) {
      if (!diff?.[name]) continue;
      engine.updateData(STAND_SOURCES[name], diff[name]).catch(error => {
        console.error('An OCC map could not update its stands.', error);
      });
    }
  }, [standFeatures]);

  // The flights: one setData when what they draw changes, never a new map. A re-read of the same flights in new
  // objects writes nothing.

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !appliedRef.current.drawsFlights) return;
    const data = toFlightFeatures(flights);
    const key = JSON.stringify(data.features);
    if (appliedRef.current.flights === key) return;
    appliedRef.current.flights = key;
    engine.setData(FLIGHT_SOURCE, data);
    markSettled(rootRef.current, false);
  }, [flights]);

  // The references (PR M8): one setData of their source when the map starts, and again only when the runway in use,
  // the counterparts or the language change what they draw; the night shade once a minute. Never a new map.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || applied.references === referenceData) return;
    applied.references = referenceData;
    engine.setData(REFERENCE_SOURCE, referenceData);
    markSettled(rootRef.current, false);
  }, [referenceData]);
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || applied.night === nightData) return;
    applied.night = nightData;
    engine.setData(NIGHT_SOURCE, nightData);
    markSettled(rootRef.current, false);
  }, [nightData]);

  // The weather (PR M8): the wind, one setData when what it draws changes (a new METAR, the runway in use, the language,
  // a METAR that ages), never on a read that brings the same; its tooltip follows.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsWeather) return;
    const key = JSON.stringify(windData.features);
    if (applied.wind === key) return;
    applied.wind = key;
    engine.setData(WIND_SOURCE, windData);
    markSettled(rootRef.current, false);
    refreshWindTooltip();
  }, [windData, refreshWindTooltip]);
  // Each satellite image pinned to the time GIBS reports, once per image and before the layers menu shows it (this
  // effect runs before the menu's); the legend follows.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsWeather) return;
    for (const key of SATELLITE_KEYS) {
      const tiles = imagery[key].status === 'ready' ? satelliteTiles(key, imagery[key]) : null;
      if (tiles === null || applied.rasterTiles[key] === tiles[0]) continue;
      applied.rasterTiles[key] = tiles[0];
      engine.setRasterTiles(SATELLITE_SOURCES[key], tiles);
      markSettled(rootRef.current, false);
    }
    updateOnScreen();
  }, [imagery, updateOnScreen]);

  // The traffic (PR M5): the aircraft, again whenever the selection, the shown groups or the language change what
  // they draw, then what is on screen. A read that moved nothing writes nothing.
  const trafficAircraft = traffic?.aircraft ?? EMPTY;
  useEffect(() => {
    writeTraffic();
    updateOnScreen();
  }, [trafficAircraft, selection, shownGroupsKey, language, writeTraffic, updateOnScreen]);

  // The trails and the chosen flight's route: one setData when what they draw changes.
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    if (!engine || !applied.drawsTraffic) return;
    for (const [sourceId, slot, data] of [[TRAILS_SOURCE, 'trails', shownTrails], [ROUTE_SOURCE, 'route', trafficRoute]]) {
      const collection = data ?? EMPTY_COLLECTION;
      const key = JSON.stringify(collection.features ?? EMPTY);
      if (applied[slot] === key) continue;
      applied[slot] = key;
      engine.setData(sourceId, collection);
    }
    updateOnScreen();
  }, [shownTrails, trafficRoute, updateOnScreen]);

  // The credit of the aircraft data (owner decision 6, contracts 2.5): «Datos de aeronaves: {source}» with its links
  // in the attribution while traffic is on screen, and out of it when none is.
  const trafficShown = snapshot.trafficOnScreen;
  const creditKey = trafficShown.kinds.length > 0 ? creditKeyOf(traffic?.source) : '';
  const trafficSource = useMemo(() => {
    if (creditKey === '') return null;
    const [name, homeUrl, licenseName, licenseUrl] = JSON.parse(creditKey);
    return Object.freeze({ name, homeUrl, licenseName, licenseUrl });
  }, [creditKey]);
  const aircraftDataLabel = t('attribution.aircraftData');
  // The credit of the aerodrome weather (PR M8): «Clima: NOAA Aviation Weather Center» while the wind is on screen.
  const windOnScreen = snapshot.referencesOnScreen.kinds.some(kind => kind === 'wind' || kind === 'windStale');
  const weatherCreditKey = windOnScreen ? creditKeyOf(weatherNow?.source) : '';
  const weatherLabel = t('attribution.weather');
  const weatherSource = useMemo(() => {
    if (weatherCreditKey === '') return null;
    const [name, homeUrl] = JSON.parse(weatherCreditKey);
    return Object.freeze({ name, homeUrl, label: weatherLabel });
  }, [weatherCreditKey, weatherLabel]);
  useEffect(() => {
    const engine = engineRef.current;
    const applied = appliedRef.current;
    // What the attribution shows: nothing of the traffic, or this source in this language; then the weather's.
    const key = [creditKey === '' ? '' : `${creditKey}|${aircraftDataLabel}`,
      weatherCreditKey === '' ? '' : `${weatherCreditKey}|${weatherLabel}`].filter(Boolean).join('#');
    if (!engine || !(applied.drawsTraffic || applied.drawsWeather) || applied.credit === key) return;
    applied.credit = key;
    engine.setAttribution(buildAttribution([trafficSource, weatherSource].filter(Boolean), { aircraftDataLabel }));
  }, [creditKey, trafficSource, aircraftDataLabel, weatherCreditKey, weatherLabel, weatherSource]);

  // A screen's own overlays: one setData for each source whose features changed, keyed like the stands and flights.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !overlayData) return;
    const applied = appliedRef.current.overlayData;
    for (const [sourceId, data] of Object.entries(overlayData)) {
      if (!data) continue;
      const key = JSON.stringify(data.features ?? []);
      if (applied[sourceId] === key) continue;
      applied[sourceId] = key;
      engine.setData(sourceId, data);
    }
  }, [overlayData]);

  // The selection: one feature in the selection source (a stand's label point with its texts, a flight's ring),
  // written only when it changes; the flags of the stands as feature state (the casing of the selected stand, the stand
  // of a selected flight, and the stands covered by the same agent as the hovered or selected one), written only where
  // they change; and, once per newly selected stand, the camera when that stand lies outside the area in sight.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const applied = appliedRef.current;
    const data = selectionFeatures(selection, {
      stands: [...attached, ...(presetStands ?? EMPTY)], flights, standLabels: standFeatures.labels,
    });
    const key = JSON.stringify(data.features);
    if (applied.selection !== key) {
      applied.selection = key;
      engine.setData(SELECTION_SOURCE, data);
      markSettled(rootRef.current, false);
    }
    if (!applied.drawsStands) return;
    const code = selection?.kind === 'stand' ? mapStandCode(selection.id) || null : null;
    const related = selection?.kind === 'flight' ? relatedEntities(selection, { flights }).standCode : null;
    const { hover } = applied.standFlags ?? NO_FLAGS;
    applyStandFlags(standFlags({ hover, selected: code, related, stands: attached }));
    if (code === applied.easedFor) return;
    applied.easedFor = code;
    const focused = focusRef.current;
    focusRef.current = null;
    if (code !== null && focused !== code) easeToStand(code);
  }, [selection, attached, presetStands, flights, standFeatures, applyStandFlags, easeToStand]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || appliedRef.current.pitchMode === pitchMode) return;
    appliedRef.current.pitchMode = pitchMode;
    const view = store.get().activeView ?? 'ramp';
    engine.easeTo({ ...cameraAngles(view, pitchMode), duration: PITCH_EASE_MS, essential: false });
  }, [pitchMode, store]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = JSON.parse(groupsKey);
    const applied = appliedRef.current.groups ?? {};
    for (const [group, visible] of Object.entries(next)) {
      if (applied[group] !== Boolean(visible)) engine.setGroupVisibility(group, Boolean(visible));
    }
    appliedRef.current.groups = Object.fromEntries(Object.entries(next).map(([group, visible]) => [group, Boolean(visible)]));
  }, [groupsKey]);

  // The groups the layers menu shows or hides (PR M5), except those the page sets itself: one call per change. A group
  // the page lets go is the menu's again.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const page = JSON.parse(groupsKey);
    const applied = appliedRef.current.menuGroups ?? {};
    const next = {};
    for (const [group, visible] of Object.entries(JSON.parse(menuGroupsKey))) {
      if (Object.hasOwn(page, group)) continue;
      if (applied[group] !== visible) engine.setGroupVisibility(group, visible);
      next[group] = visible;
    }
    appliedRef.current.menuGroups = next;
  }, [groupsKey, menuGroupsKey]);

  // While a stand is being placed a click gives its point: no tooltip stays open over the map and no stand stays marked
  // as under the pointer.
  useEffect(() => {
    engineRef.current?.setCursor(placingNow ? 'crosshair' : '');
    if (!placingNow) return;
    store.set({ tooltip: null });
    hoverStand(null);
  }, [placingNow, store, hoverStand]);

  // The pending location of the stand being placed, drawn as its box, and the box at the pointer, which goes when the
  // placing ends or moves to another stand (the next pointer move draws that one).
  const pendingKey = placingStand && pendingLocation
    ? `${pendingLocation.longitude}|${pendingLocation.latitude}`
    : null;
  const placingCode = placingStand ? mapStandCode(placingStand.code) || null : null;
  const placingSize = placingStand?.sizeHint ?? null;
  useEffect(() => {
    const applied = appliedRef.current;
    if (!engineRef.current || !applied.drawsStands) return;
    const point = pendingKey === null ? null : pendingKey.split('|').map(Number);
    const pending = point === null || placingCode === null
      ? null
      : placingGhost({ code: placingCode, pointer: point, layout, sizeHint: placingSize });
    const shown = (pending !== null) !== (applied.pendingGhost !== null) || (placingCode !== applied.placingCode && applied.ghost !== null);
    applied.pendingGhost = pending;
    if (placingCode !== applied.placingCode) {
      applied.placingCode = placingCode;
      applied.ghost = null;
    }
    writeGhost();
    if (shown) updateOnScreen();
  }, [pendingKey, placingCode, placingSize, layout, writeGhost, updateOnScreen]);

  // The map keys (contracts 2.2) on keydown at the map's root, in the bubble phase, never on document. 1 to 4 are
  // the views while the map can draw; Esc cancels the placing of a stand first, then clears a selection, after a drawer
  // or dialog has closed on its own Esc. No key of its own is added for the placing.
  useEffect(() => {
    const root = rootRef.current;
    const handlers = {};
    for (const view of VIEW_NAMES) {
      Object.defineProperty(handlers, `view.${view}`, {
        enumerable: true,
        get: () => (store.get().engineStatus === 'unavailable' ? undefined : () => requestView(view)),
      });
    }
    // The layers menu (PR M5): L opens and closes it while the map shows one and can draw.
    Object.defineProperty(handlers, 'toggleLayers', {
      enumerable: true,
      get: () => (layersMenusRef.current > 0 && store.get().engineStatus !== 'unavailable'
        ? () => latest.current?.setLayersMenuOpen(!latest.current.layersMenuOpen)
        : undefined),
    });
    Object.defineProperty(handlers, 'clearSelection', {
      enumerable: true,
      get: () => {
        // An open layers menu closes first (PR M5); then Esc stops the placing of a stand (PR M4); the selection waits
        // for the next Esc.
        if (latest.current?.layersMenuOpen) return () => latest.current.setLayersMenuOpen(false);
        const { selection: current, onSelect: select, placing: placingStandNow, onCancelPlacing: cancel } = latest.current ?? {};
        if (placingStandNow && cancel) return () => cancel();
        return current && select ? () => select(null) : undefined;
      },
    });
    const handle = createOccShortcutHandler(handlers, { isBlocked: () => Boolean(latest.current?.isShortcutBlocked?.()) });
    const listener = event => {
      handle(event);
    };
    root.addEventListener('keydown', listener);
    return () => root.removeEventListener('keydown', listener);
  }, [requestView, store]);

  useImperativeHandle(ref, () => ({
    flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, jumpTo, project, whenIdle,
  }), [flyToPreset, flyToStand, flyToFlight, flyToBounds, flyToAll, flyToPuj, resetNorth, getCamera, jumpTo, project, whenIdle]);

  // The overlays read only these: the tooltip, which changes with the pointer, renders here and re-renders none of them.
  const {
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, chipsOnScreen, standMarksOnScreen,
    flightsOnScreen, airfieldOnScreen,
  } = snapshot;
  const context = useMemo(() => ({
    engineStatus,
    basemapStatus,
    activeView,
    fits,
    thresholds,
    standsOnScreen,
    chipsOnScreen,
    standMarksOnScreen,
    flightsOnScreen,
    airfieldOnScreen,
    requestView,
    flyToPreset,
    flyToStand,
    flyToFlight,
  }), [
    engineStatus, basemapStatus, activeView, fits, thresholds, standsOnScreen, chipsOnScreen, standMarksOnScreen,
    flightsOnScreen, airfieldOnScreen, requestView, flyToPreset, flyToStand, flyToFlight,
  ]);
  // With the traffic on screen and its source (PR M5), for the legend and the status over the map, and the layers menu;
  // and the references on screen (PR M8), for the legend.
  const { layerKeys, referencesOnScreen } = snapshot;
  // What the layers menu says under a weather key that is on and shows nothing (PR M8): why, or the time of its image;
  // the same words keep the same object, so the minute does not re-render the menu.
  const layerNotesKey = drawsWeather ? JSON.stringify(weatherLayerNotes({ layers: resolvedLayers, view: layerView, imagery,
    weather: weatherNow, nowMs: referenceMinute, language })) : '';
  const layerNotes = useMemo(() => (layerNotesKey === '' ? NO_NOTES : Object.freeze(JSON.parse(layerNotesKey))),
    [layerNotesKey]);
  const layers = useMemo(() => Object.freeze({ keys: layerKeys, values: resolvedLayers, notes: layerNotes }),
    [layerKeys, resolvedLayers, layerNotes]);
  const mapContext = useMemo(() => ({
    ...context, trafficOnScreen: trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen,
    registerLayersMenu, referencesOnScreen,
  }), [context, trafficShown, trafficSource, layers, setLayer, layersMenuOpen, setLayersMenuOpen, registerLayersMenu,
    referencesOnScreen]);

  // The list of the fallback: the adapter's own items, else the stands of the screen, else those that frame the views.
  const listedStands = stands.length > 0 ? stands : referenceStands;
  const items = useMemo(() => fallbackItems ?? standsInView(listedStands)
    .map(stand => ({ id: standCodeOf(stand), label: standCodeOf(stand), kind: 'stand' }))
    .filter(item => item.id !== ''), [fallbackItems, listedStands]);
  const selectFallback = (id, item) => {
    if (onFallbackSelect) onFallbackSelect(id, item);
    else onSelect?.({ kind: item?.kind ?? 'stand', id });
  };
  // Contract 2.6: the OCC boot screen (PR U4) waits for the first screen with its data on screen. The map reports
  // once its engine settles: `ready` (the style loaded, so the airfield and the stands draw even without the base map)
  // or `unavailable` (the fallback list is what the screen shows). Outside the OCC frame markReady is a no-op, and
  // the provider counts only the first report.
  useEffect(() => {
    if (engineStatus === 'ready' || engineStatus === 'unavailable') markReady('map');
  }, [engineStatus, markReady]);
  const unavailable = engineStatus === 'unavailable';

  return (
    <OccMapContext.Provider value={mapContext}>
      <div
        ref={rootRef}
        data-testid="occ-map"
        data-occ-engine={engineStatus}
        data-occ-basemap={basemapStatus}
        data-occ-view={activeView ?? undefined}
        className={`occ-map absolute inset-0 overflow-hidden bg-occ-canvas ${className}`.trim()}
        style={insetVariables(padding)}
      >
        <div ref={hostRef} data-testid={testId} className="h-full w-full" />
        {unavailable && (
          <MapUnavailable
            title={labels?.unavailableTitle ?? t('unavailable.title')}
            description={labels?.unavailableDescription ?? t('unavailable.description')}
            listLabel={labels?.unavailableList ?? t('unavailable.list')}
            items={items}
            selectedId={selection?.id ?? null}
            onSelect={selectFallback}
          />
        )}
        {!unavailable && basemapStatus === 'degraded' && (
          <p role="status" className="occ-map-chip rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
            {t('basemap.degraded')}
          </p>
        )}
        {children}
        {!unavailable && <MapTooltip tooltip={snapshot.tooltip} />}
      </div>
    </OccMapContext.Provider>
  );
});

export default OccMap;
