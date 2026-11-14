// Copy of the map kinematics (PR M6, contracts 2.3), Spanish first with English for the OCC screens: what the data
// block says of a demo aircraft that waits for a stand, was cancelled by the provider or runs faster than real time,
// of an aircraft without a recent signal, and the labels of the chosen flight's route. The pure modules of this
// folder return keys (a sample's or a render's `statusKey`, a trajectory's `scaledParts`, a route feature's
// `labelKey`), never text; a screen resolves them with createTranslator (src/i18n/languageStore.js), as
// mapMessages.js is. The tags «Demo» and «est.» are not here: they come from src/features/occ-ui/statusVocabulary.js
// (TAGS), so every screen uses the same words. Plain data and one formatter; no imports, no clock.

export const kinematicsMessages = {
  es: {
    demo: {
      awaitingStandNotImported: 'Esperando posición · sin importar',
      awaitingStand: 'Esperando posición',
      cancelled: 'Cancelado por el proveedor (demo)',
      // `factor` is formatTimeScale's text: «Demo acelerada ×1,9».
      accelerated: 'Demo acelerada {factor}',
    },
    track: {
      // `seconds` is the age of the last fix in whole seconds (kinematics/handoff.js: a render's `ageS`).
      noSignal: 'Sin señal desde hace {seconds} s',
    },
    route: {
      flownEstimated: 'Trayecto estimado',
      positionPending: 'Posición por asignar',
    },
  },
  en: {
    demo: {
      awaitingStandNotImported: 'Waiting for a stand · not imported',
      awaitingStand: 'Waiting for a stand',
      cancelled: 'Cancelled by the provider (demo)',
      accelerated: 'Accelerated demo {factor}',
    },
    track: {
      noSignal: 'No signal for {seconds} s',
    },
    route: {
      flownEstimated: 'Estimated path',
      positionPending: 'Stand to be assigned',
    },
  },
};

/**
 * The message of each status a trajectory sample (estimator.js, demoProfile.js) or a track render (handoff.js) can
 * carry, by its key.
 */
export const STATUS_MESSAGES = Object.freeze({
  awaitingStandNotImported: 'demo.awaitingStandNotImported',
  awaitingStand: 'demo.awaitingStand',
  cancelledByProvider: 'demo.cancelled',
  noSignal: 'track.noSignal',
});

/** The message of each label a route feature can carry (flightRoute.js: `labelKey`), by its key. */
export const ROUTE_LABELS = Object.freeze({
  flownEstimated: 'route.flownEstimated',
  positionPending: 'route.positionPending',
});

/**
 * A time scale with one decimal, as «Demo acelerada» shows it: '×1,9' in Spanish (decimal comma), '×1.9' in English.
 * A scale above 1 never reads ×1,0 (it reads ×1,1), so the label always names a real speed-up; a scale that is not a
 * positive number gives ''.
 */
export function formatTimeScale(scale, language = 'es') {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return '';
  let value = Math.round(scale * 10) / 10;
  if (scale > 1 && value <= 1) value = 1.1;
  const text = value.toFixed(1);
  return `×${language === 'en' ? text : text.replace('.', ',')}`;
}
