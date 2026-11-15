// Copy of the map kinematics (PR M6, contracts 2.3), Spanish first with English for the OCC screens: what the data
// block says of a demo aircraft that waits for a stand, was cancelled by the provider or does not run in real time,
// of an aircraft without a recent signal, and the labels of the chosen flight's route. The pure modules of this
// folder return keys (a sample's or a render's `statusKey`, a trajectory's `scaledParts`, a route feature's
// `labelKey`), never text; a screen resolves them with createTranslator (src/i18n/languageStore.js), as
// mapMessages.js is. The tags «Demo» and «est.» are not here: they come from src/features/occ-ui/statusVocabulary.js
// (TAGS), so every screen uses the same words. Plain data, one formatter and one lookup; no imports, no clock.

export const kinematicsMessages = {
  es: {
    demo: {
      awaitingStandNotImported: 'Esperando posición · sin importar',
      awaitingStand: 'Esperando posición',
      cancelled: 'Cancelado por el proveedor (demo)',
      // `factor` is formatTimeScale's text: «Demo acelerada ×1,9», «Demo ralentizada ×0,8».
      accelerated: 'Demo acelerada {factor}',
      slowed: 'Demo ralentizada {factor}',
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
      slowed: 'Slowed-down demo {factor}',
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

/** Between these two scales, both left out, «Demo acelerada» shows two decimals: one would round a small change away. */
export const TIME_SCALE_FINE = Object.freeze({ below: 1.1, above: 0.9 });

/**
 * A time scale as «Demo acelerada» shows it: '×1,9' in Spanish (decimal comma), '×1.9' in English. Between ×0,9 and
 * ×1,1, both left out, it has two decimals, so a small compression reads as it is ('×1,02', never a rounded-up ×1,1),
 * and a scale off 1 never reads ×1,00: above 1 it reads ×1,01 at least, below ×0,99 at most. Outside that band it has
 * one decimal and never reads ×0,0 (×0,1 at least). A scale of exactly 1 reads '×1,0'; one that is not a positive
 * number gives ''.
 */
export function formatTimeScale(scale, language = 'es') {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return '';
  const fine = scale !== 1 && scale > TIME_SCALE_FINE.above && scale < TIME_SCALE_FINE.below;
  let text;
  if (fine) {
    let value = Math.round(scale * 100) / 100;
    if (scale > 1) value = Math.max(1.01, value);
    else value = Math.min(0.99, value);
    text = value.toFixed(2);
  } else {
    let value = Math.round(scale * 10) / 10;
    if (scale < 1) value = Math.max(0.1, Math.min(0.9, value));
    text = value.toFixed(1);
  }
  return `×${language === 'en' ? text : text.replace('.', ',')}`;
}

/**
 * The message of a time scale (a demo trajectory's `timeScale`, or the one its legs carry for their part):
 * 'demo.accelerated' above 1 («Demo acelerada ×1,9»), 'demo.slowed' below («Demo ralentizada ×0,8»), with
 * formatTimeScale's text as `factor`; `null` at 1 and for a scale that is not a positive number (nothing is said).
 */
export function timeScaleMessage(scale) {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale === 1) return null;
  return scale > 1 ? 'demo.accelerated' : 'demo.slowed';
}
