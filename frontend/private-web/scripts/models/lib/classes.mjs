// The class of a part of a source model (plan M5), from its names: what the livery shader paints (body), the glass
// and the dark trim. Pure; used by build-aircraft-models.mjs.

// What a part is, from its names: glass (windows and windshields), dark (engine insides, fans, exhausts, tyres, black
// and metal trim) or body.
const GLASS = /glass|window|windshield|transparent|^emit|cockpitwin/i;
const DARK = new RegExp([
  'black', 'rubber', 'dark', 'tire', 'tyre', 'nozzle', 'exhaust', 'tailpipe', 'intake.?interior', '^fan', 'fan$',
  'fanwheel', 'blade', 'shroud', 'casing', '^core', 'spinner', 'chrome', 'metal', 'alumin', 'grey', 'gray', 'nospec',
  'wire', 'duct', 'opening', 'engcore', '^turbofan_\\d',
].join('|'), 'i');
// The outer skin of a nacelle (fan cowl, intake lip, thrust reverser cowl) carries the livery's engine colour, though
// its names may say «fan» (FANCOWL, LReverserTurbofan): QA of 2026-11-28 found the A320 family and 757 nacelles black.
// The inside of the intake, the fan face (the 757's turbofan_N discs) and the aft faces (the CRJ900's ReverserRear,
// black) stay dark.
const NACELLE_SKIN = /fancowl|reverser|^nacelle(\.\d+)?$|^intake(\.\d+)?$|^engine[lr](\.\d+)?$/i;
const NACELLE_INSIDE = /intake.?interior|rear/i;
export function classify(...names) {
  const given = names.filter(Boolean);
  if (given.some(name => GLASS.test(name))) return 'glass';
  if (!given.some(name => NACELLE_INSIDE.test(name)) && given.some(name => NACELLE_SKIN.test(name))) return 'body';
  if (given.some(name => DARK.test(name))) return 'dark';
  return 'body';
}
