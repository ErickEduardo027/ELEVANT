import { planningMessages } from '../planning/planningMessages';

/**
 * Why a stand cannot take a demo flight (ADR-0041, owner decision 22), in Spanish. One table: the codes of OCC's
 * assignment rule (`OccAgentEligibilityPolicy`) say what OCC's planning says for them, and the panel adds its own three:
 * nobody covers the stand when the aircraft parks (`stand_not_covered`), the map does not know where it is
 * (`stand_not_located`, also the reason of a refused stand) and it is not free for the visit (`stand_not_free`, the
 * panel's name for a stand whose `free` is false: taken, cancelled by a combined stand or too small for the aircraft; the
 * API never sends it).
 */
const ASSIGNMENT = planningMessages.es.assignment;

export const DEMO_STAND_REASON_TEXT = Object.freeze({
  ...ASSIGNMENT.reasons,
  stand_not_covered: 'Nadie la cubre a esa hora',
  stand_not_located: 'Sin ubicar en el mapa',
  stand_not_free: 'No está libre para ese avión en ese horario',
});

/** The text of one reason; a code this table does not know yet says what OCC's planning says for an unknown one. */
export function standReasonText(code) {
  return typeof code === 'string' && Object.hasOwn(DEMO_STAND_REASON_TEXT, code)
    ? DEMO_STAND_REASON_TEXT[code]
    : ASSIGNMENT.unknownReason;
}

const LIST = new Intl.ListFormat('es', { type: 'conjunction' });
const lowerFirst = text => text.charAt(0).toLocaleLowerCase('es') + text.slice(1);

/**
 * The reasons as one phrase in lower case, to follow a colon: «nadie la cubre a esa hora y turno no compatible». Each
 * text once, in the order given; empty without reasons.
 */
export function reasonsSentence(codes) {
  const texts = [...new Set((codes ?? []).map(standReasonText))];
  return LIST.format(texts.map(lowerFirst));
}
