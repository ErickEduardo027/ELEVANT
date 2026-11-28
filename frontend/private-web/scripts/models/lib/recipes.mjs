// How each aircraft type's 3D model is made (scripts/models/build-aircraft-models.mjs), from the evaluation of M5
// step 1 (models-src/EVALUACION.md): the base model and its source frame, what to drop, and the adjustments that bring a
// sibling to its own type (fuselage plugs, engines, wingtips). Stations are metres from the nose of the base model at
// its own type's length; a plug's share splits the type's length difference (types.js) between its runs. Pure data.

// The REXO 737 MAX in AC3D: its cabin, the coplanar decals (they z-fight), its extended landing gear (the app draws its
// procedural gear) and the light halos.
const REXO_DROP = [
  /^interior\.(fwd|aft)$/, /^overlay\./, /^(mlg|nlg)\.(?!bay$)/, /^light\./, /^lights\./, /^lightning\./, /^beacon$/,
];
// Light halos, lenses and beacons, which the app draws itself.
const LIGHTS = [
  /beacon/i, /strobe/i, /flash/i, /^a-light/i, /^nav[01]$/i, /navli/i, /^lights\./i, /landlt|landing-[lr]$/i,
  /land-light/i, /turnoff/i, /logolts|winglts|lltcover/i, /^tlight$/i, /^(lh|rh)light$/i, /^redlight/i,
];
// The A330s carry a second, Pratt & Whitney nacelle inside the General Electric one.
const A330_DROP = [/^pw\./, ...LIGHTS];

const FR24 = Object.freeze({
  licence: 'GPL-2.0-only', licenceFiles: ['mbr1376/LICENSE'], readme: 'mbr1376/README.md', frame: 'nose-Z',
  credit: 'Aleksei Kalmykov (kalmykov) / Flightradar24, repositorio fr24-3d-models; conversión a glTF 2.0 de mbr1376',
});
const FAM = Object.freeze({
  readme: 'fam/README.md', frame: 'nose+Z', drop: LIGHTS,
  credit: 'Ysurac, repositorio FlightAirMap-3dmodels (modelos de FGMEMBERS vía fr24-3d-models de Aleksei Kalmykov / '
    + 'Flightradar24)',
});
const famLicence = (folder, licence = 'GPL-2.0-only', file = 'COPYING') => ({
  licence, licenceFiles: [`fam/${folder}/${file}`],
});

// The A320 family's sharklets (2.43 m high, 35.8 m span), procedural on the ceo and the neo: the base wing is first
// brought to the 34.1 m of a wing without them. The shape is estimated.
const A320_SHARKLETS = Object.freeze({ kind: 'sharklet', spanBeforeM: 34.1, heightM: 2.43, sweepDeg: 38, taper: 0.32 });
// The neo's nacelles (CFM LEAP-1A, PW1100G): 2.3 m over the ceo's 2.0 m (types.js), and longer.
const NEO_NACELLE = 2.3 / 2;

export const BASES = Object.freeze({
  B738: { ...FR24, source: 'mbr1376/models/gltf_v2/airplane/b738.glb', upstream: 'FGMEMBERS/737-800',
    drop: LIGHTS, describe: 'Boeing 737-800' },
  B77W: { ...FR24, source: 'mbr1376/models/gltf_v2/airplane/b773.glb', upstream: 'FGMEMBERS/777',
    upstreamNote: 'FGMEMBERS/777 no trae archivo de licencia (solo AUTHORS: Syd Adams, Karla); fr24 publica el modelo '
      + 'como GPLv2',
    drop: LIGHTS, describe: 'Boeing 777-300' },
  B39M: { source: 'rexo/Models/737-9.ac', frame: 'nose-X', licence: 'GPL-2.0-only', licenceFiles: ['rexo/LICENSE'],
    readme: 'rexo/README.md', upstream: 'REXO-77/737-MAX', drop: REXO_DROP, describe: 'Boeing 737 MAX 9',
    credit: 'REXO-77/737-MAX: Israel Emmanuel (naviat-dev), SP-NTX, Captain Jake, Semir Gebran (CaptB), Marsdolphin y '
      + 'otros; «Original model by omri_ha_muglob»' },
  A319: { ...FAM, ...famLicence('a320'), source: 'fam/a320/glTF2/A319.glb', upstream: 'FGMEMBERS/A320-family',
    describe: 'Airbus A319' },
  A320: { ...FAM, ...famLicence('a320'), frame: 'nose+X', source: 'fam/a320/glTF2/A320.glb',
    upstream: 'FGMEMBERS/A320-family', describe: 'Airbus A320' },
  A321: { ...FAM, ...famLicence('a320'), source: 'fam/a320/glTF2/A321.glb', upstream: 'FGMEMBERS/A320-family',
    describe: 'Airbus A321' },
  A332: { ...FAM, ...famLicence('a332'), source: 'fam/a332/glTF2/A332.glb', upstream: 'FGMEMBERS/A330-200',
    drop: A330_DROP, describe: 'Airbus A330-200' },
  A333: { ...FAM, ...famLicence('a333'), source: 'fam/a333/glTF2/A333.glb', upstream: 'FGMEMBERS/A330-300',
    drop: A330_DROP, describe: 'Airbus A330-300' },
  B752: { ...FAM, ...famLicence('b752', 'GPL-2.0-or-later', 'LICENSE'), frame: 'nose+X',
    source: 'fam/b752/glTF2/B752.glb', upstream: 'FGMEMBERS/757-200', describe: 'Boeing 757-200' },
  B788: { ...FAM, ...famLicence('b788'), source: 'fam/b788/glTF2/B788.glb', upstream: 'FGMEMBERS/787-8',
    describe: 'Boeing 787-8' },
  E190: { ...FAM, ...famLicence('e190', 'GPL-2.0-only', 'License.txt'), source: 'fam/e190/glTF2/E190.glb',
    upstream: 'FGMEMBERS/E-jet-family', describe: 'Embraer E190' },
  // crj9/LICENSE is a short notice («version 2 or above»): the full GPLv2 text goes with it, from the same repository.
  CRJ9: { ...FAM, licence: 'GPL-2.0-or-later', licenceFiles: ['fam/crj9/LICENSE', 'fam/a320/COPYING'],
    source: 'fam/crj9/glTF2/CRJ9.glb', upstream: 'FGMEMBERS/CRJ700-family',
    drop: [/stair/i, /^RAT/, /^LandingLt/, ...LIGHTS], describe: 'Bombardier CRJ900' },
  // The ATR 72-500 of FlightAirMap stands for the -600 (same dimensions). GPL-3.0: kept apart from GPL-2.0-only files.
  AT76: { ...FAM, ...famLicence('atr72', 'GPL-3.0-only', 'LICENCE.txt'), source: 'fam/atr72/glTF2/AT75.glb',
    upstream: 'FlightGear ATR 72-500 (FGMEMBERS), según el README de FlightAirMap', drop: [/propblur/i, ...LIGHTS],
    describe: 'ATR 72-500 (por el ATR 72-600)' },
});

/**
 * One recipe per type: `base` (a key of BASES; its own type when the model is the base's), `name` (when it is not the
 * base's), `plugs` ([fromM, toM, share] runs of constant section), `nacelles` ({ seed, scale, lengthen }) and `tips` (a
 * wingtip device).
 */
export const RECIPES = Object.freeze({
  B738: { base: 'B738' },
  B737: { base: 'B738', name: 'Boeing 737-700', plugs: [[6.5, 14.75, 0.582], [21.25, 26.25, 0.418]] },
  B739: { base: 'B738', name: 'Boeing 737-900ER', plugs: [[6.5, 14.75, 0.595], [21.25, 26.25, 0.405]] },
  B39M: { base: 'B39M' },
  B38M: { base: 'B39M', name: 'Boeing 737 MAX 8', plugs: [[9.0, 15.75, 0.595], [24.5, 30.5, 0.405]] },
  A319: { base: 'A319', tips: A320_SHARKLETS },
  A320: { base: 'A320', tips: A320_SHARKLETS },
  A20N: { base: 'A320', name: 'Airbus A320neo', tips: A320_SHARKLETS,
    nacelles: { seed: /^(EngineL|EngineR|Intake(\.001)?|Nacelle(\.001)?)$/, scale: NEO_NACELLE, lengthen: 1.12 } },
  A321: { base: 'A321', tips: A320_SHARKLETS },
  A21N: { base: 'A321', name: 'Airbus A321neo', tips: A320_SHARKLETS,
    nacelles: { seed: /^(Engine [12]|Intake(\.001)?|Nacelle(\.001)?)$/, scale: NEO_NACELLE, lengthen: 1.12 } },
  A332: { base: 'A332' },
  A333: { base: 'A333' },
  // Trent 7000 nacelles: 3.4 m over the 3.0 m of the A330-300's (types.js).
  A339: { base: 'A333', name: 'Airbus A330-900',
    nacelles: { seed: /^(ge\.(?!pylon)|fan)/, scale: 3.4 / 3, lengthen: 1.08 },
    tips: { kind: 'sharklet', heightM: 4.35, sweepDeg: 38, taper: 0.32 } },
  // GE90-115B nacelles: 3.9 m over the 3.5 m of the 777-200's (types.js), on the 777-300 model.
  B77W: { base: 'B77W', name: 'Boeing 777-300ER',
    nacelles: { seed: /^(Engines|Reversers|Inlets)$/, scale: 3.9 / 3.5, lengthen: 1.05 },
    tips: { kind: 'raked', sweepDeg: 55, taper: 0.25, dihedralDeg: 6 } },
  B772: { base: 'B77W', name: 'Boeing 777-200', plugs: [[8.5, 26.5, 0.523], [43.0, 53.75, 0.477]] },
  B752: { base: 'B752' },
  B788: { base: 'B788' },
  B789: { base: 'B788', name: 'Boeing 787-9', plugs: [[7.75, 16.75, 0.5], [31.5, 39.5, 0.5]] },
  E190: { base: 'E190' },
  E195: { base: 'E190', name: 'Embraer E195', plugs: [[5.75, 10.5, 0.54], [20.5, 25.5, 0.46]] },
  CRJ9: { base: 'CRJ9' },
  AT76: { base: 'AT76', name: 'ATR 72-600' },
});
