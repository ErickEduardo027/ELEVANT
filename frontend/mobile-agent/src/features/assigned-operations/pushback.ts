import { FLIGHT_REPORT_MILESTONES, FLIGHT_REPORT_PHASES, type FlightReportPhase } from '@elevant/api-client';

/** The flight report's last milestone (ADR-0031): the aircraft leaves the stand. */
export { PUSHBACK_MILESTONE } from './pushback-recorded';
const BLOCK_ON_MILESTONE = 'BLOCK_ON';

/** The phases between the block-on and the push-back, in the order of the flight. */
type PhaseBeforePushback = Extract<FlightReportPhase, 'on_stand' | 'departure'>;
const PHASES_BEFORE_PUSHBACK: readonly PhaseBeforePushback[] = ['on_stand', 'departure'];

/** Why the tablet asks before recording the push-back, in the order of the flight; a phase is named by its id. */
export type PushbackConcernKind = 'blockOn' | PhaseBeforePushback | 'services' | 'signedOrder';

export type PushbackConcern = Readonly<{
  kind: PushbackConcernKind;
  /** The reason as the sheet lists it: «En posición: 0 de 13 hitos registrados.». */
  text: string;
}>;

export type PushbackConcernsInput = Readonly<{
  /** The milestones with a time, confirmed by ELEVANT or saved on the device. */
  recorded: ReadonlySet<string>;
  /** The services as the agent left them on the device (3-I): a start still in the queue counts. */
  services: readonly Readonly<{ status: string }>[];
  /** The Service Order already carries a signature on its content (`serviceOrderHasSignature` in handoff.ts). */
  orderSigned: boolean;
}>;

const phaseLabel = (id: FlightReportPhase) => FLIGHT_REPORT_PHASES.find(phase => phase.id === id)?.label ?? id;

/**
 * Why the tablet asks before the push-back is recorded (N2, D-N2). Recording it releases the stand in OCC (ADR-0041,
 * decision 23), ends the ground time and sets the departure time the forms print, and correcting its time later does
 * not take the stand back. The reasons, in the order of the flight:
 * - the block-on is not recorded;
 * - «En posición» or «Salida» has no milestone recorded, each said apart;
 * - no service left «Planned», only when the operation has services;
 * - the Service Order already has a signature, which the push-back makes stale.
 * Empty when nothing is off: one tap records it, as before. The tablet only asks; ELEVANT's rule does not change (3-N25:
 * a block-on never after the push-back).
 */
export function pushbackConcerns({ recorded, services, orderSigned }: PushbackConcernsInput): PushbackConcern[] {
  const concerns: PushbackConcern[] = [];
  if (!recorded.has(BLOCK_ON_MILESTONE)) {
    const blockOn = FLIGHT_REPORT_MILESTONES.find(item => item.code === BLOCK_ON_MILESTONE);
    concerns.push({
      kind: 'blockOn',
      text: `${phaseLabel(blockOn?.phase ?? 'arrival')}: falta «${blockOn?.label ?? 'Bloqueo'}».`,
    });
  }
  for (const phase of PHASES_BEFORE_PUSHBACK) {
    const milestones = FLIGHT_REPORT_MILESTONES.filter(item => item.phase === phase);
    if (milestones.length === 0 || milestones.some(item => recorded.has(item.code))) continue;
    const total = milestones.length;
    concerns.push({
      kind: phase,
      text: `${phaseLabel(phase)}: 0 de ${total} ${total === 1 ? 'hito registrado' : 'hitos registrados'}.`,
    });
  }
  // A service not performed or in an exception was decided on: only a list that is all «Planned» says none started.
  if (services.length > 0 && services.every(service => service.status === 'Planned')) {
    concerns.push({ kind: 'services', text: services.length === 1
      ? 'Servicios: el servicio no se inició.'
      : `Servicios: ninguno de los ${services.length} se inició.` });
  }
  if (orderSigned) {
    concerns.push({ kind: 'signedOrder',
      text: 'Orden de Servicio: ya tiene firma; el push-back cambia su hora de salida y hay que volver a firmarla.' });
  }
  return concerns;
}

/**
 * What recording the push-back does, as the sheet says it: it releases the operation's stand in OCC (decision 23), for
 * good, closes the ground time and sets the Service Order's departure time. Without a stand there is none to release.
 */
export function pushbackEffect(standCode: string | null | undefined) {
  const closes = 'cierra el tiempo en tierra y fija la hora de salida de la Orden de Servicio';
  return standCode
    ? `Registrarlo libera la posición ${standCode} en OCC, ${closes}. Corregir la hora después no vuelve a ocupar la ` +
      'posición.'
    : `Registrarlo ${closes}.`;
}

