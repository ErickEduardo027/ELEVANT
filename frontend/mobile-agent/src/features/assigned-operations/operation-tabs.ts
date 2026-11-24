import { handoffHoldsFor, isServiceFinished, type HandoffRequirement } from './handoff';

/**
 * CN-22: the operation's screen, once it started, in five tabs under its card: what the agent reads first, the flight,
 * the services, the forms and the close. Only the presentation changes: every section, rule and call stays the same.
 */
export type OperationTab = 'resumen' | 'vuelo' | 'servicios' | 'documentos' | 'cierre';

export const OPERATION_TABS: readonly Readonly<{ id: OperationTab; label: string }>[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'vuelo', label: 'Vuelo' },
  { id: 'servicios', label: 'Servicios' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'cierre', label: 'Cierre' },
];

/**
 * - `done`: nothing left there for the hand-off.
 * - `pending`: something left to do.
 * - `warning`: worth a look, without holding anything.
 */
export type OperationTabTone = 'done' | 'pending' | 'warning';

export type OperationTabProgress = Readonly<{
  /** The short hint next to the tab's name («3/5», «✓», «Firmar», «!»); null when the tab has none. */
  hint: string | null;
  tone: OperationTabTone | null;
  /** What a screen reader says for the hint, after the tab's name. */
  spoken: string | null;
}>;

export type OperationTabsInput = Readonly<{
  /** The hand-off's requirements as the close lists them (`handoffRequirements`): the tabs say the same. */
  requirements: readonly HandoffRequirement[];
  /** The services as the agent left them on the device (3-I). */
  services: readonly Readonly<{ status: string }>[];
  /** OCC returned the operation: the summary holds its reason. */
  returned: boolean;
  /** The execution is closed for the agent (handed off, approved): the close has nothing left. */
  closed: boolean;
}>;

const NONE: OperationTabProgress = { hint: null, tone: null, spoken: null };
const DONE = (spoken: string): OperationTabProgress => ({ hint: '✓', tone: 'done', spoken });

/** Each tab's progress hint, from the same data the close's requirements use; nothing the tablet cannot tell. */
export function operationTabProgress(input: OperationTabsInput): Readonly<Record<OperationTab, OperationTabProgress>> {
  const byKind = new Map(input.requirements.map(requirement => [requirement.kind, requirement] as const));

  const resumen: OperationTabProgress = input.returned
    ? { hint: '!', tone: 'warning', spoken: 'devuelta por OCC' }
    : NONE;

  const flightData = byKind.get('flightData');
  const vuelo: OperationTabProgress = flightData?.state === 'ok'
    ? DONE('datos del vuelo completos')
    : flightData?.state === 'warning' || flightData?.state === 'missing'
      ? { hint: '!', tone: 'warning', spoken: 'revisar los datos del vuelo' }
      : NONE;

  const total = input.services.length;
  const finished = input.services.filter(service => isServiceFinished(service.status)).length;
  const servicios: OperationTabProgress = total === 0
    ? NONE
    : { hint: `${finished}/${total}`, tone: finished === total ? 'done' : 'pending',
      spoken: `${finished} de ${total} ${total === 1 ? 'terminado' : 'terminados'}` };

  const order = byKind.get('serviceOrder');
  const documentos: OperationTabProgress = order?.state === 'ok'
    ? DONE('Orden de Servicio firmada')
    : order?.state === 'missing'
      ? { hint: 'Firmar', tone: 'pending', spoken: 'falta firmar la Orden de Servicio' }
      : NONE;

  const holds = handoffHoldsFor(input.requirements).length;
  const met = input.requirements.length - holds;
  const cierre: OperationTabProgress = input.closed
    ? DONE('ejecución cerrada')
    : input.requirements.length === 0
      ? NONE
      : holds === 0
        ? DONE('lista para entregar a OCC')
        : { hint: `${met}/${input.requirements.length}`, tone: 'pending',
          spoken: `${holds} ${holds === 1 ? 'requisito pendiente' : 'requisitos pendientes'} para entregar` };

  return { resumen, vuelo, servicios, documentos, cierre };
}
