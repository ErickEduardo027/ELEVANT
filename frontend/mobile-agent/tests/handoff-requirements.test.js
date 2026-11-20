// N1: the close lists and checks every requirement of the hand-off to OCC in one place (handoff.ts): the services,
// the checklist, the incidents still on the device, the flight data on the Service Order (S1, a warning only), the
// signed Service Order and the records still in the queue. The tablet asks the agent to confirm only what it cannot
// check; an unknown state or a warning never holds the hand-off.
const {
  HANDOFF_CHECKLIST_NOT_SUBMITTED,
  HANDOFF_PENDING_INCIDENTS,
  HANDOFF_PENDING_QUEUE,
  HANDOFF_SERVICE_ORDER_UNSIGNED,
  checklistQueuedFor,
  checklistStanding,
  flightDataQueuedFor,
  handoffHoldsFor,
  handoffRequirements,
  isHandoffHold,
  isServiceFinished,
} = require('../src/features/assigned-operations/handoff');

const OPERATION_ID = '70000000-0000-4000-8000-000000000005';
/** The Service Order's flight data, complete. */
const COMPLETE = { passengersIn: 142, passengersOut: 138, mtowKg: 78000 };
const signed = (overrides = {}) => ({ documents: [
  { kind: 'FlightReport', isFullySigned: false, staleRoles: [], summary: { passengersIn: null } },
  { kind: 'ServiceOrder', isFullySigned: true, staleRoles: [], summary: COMPLETE, ...overrides },
] });

/** Everything ready: a finished service, the checklist sent, nothing left on the device and the Order signed. */
function ready(overrides = {}) {
  return {
    services: [{ status: 'Completed' }],
    checklist: 'submitted',
    unsentIncidents: 0,
    documents: signed(),
    waitingRecords: 0,
    ...overrides,
  };
}

const requirement = (input, kind) => handoffRequirements(input).find(item => item.kind === kind);

describe('handoffRequirements (N1)', () => {
  test('lists the services, the checklist, the incidents, the flight data, the signed Order and the queue, in that order',
    () => {
      const requirements = handoffRequirements(ready());
      expect(requirements.map(item => item.kind)).toEqual(['services', 'checklist', 'incidents', 'flightData',
        'serviceOrder', 'queue']);
      expect(requirements.map(item => item.label)).toEqual([
        'Servicios terminados',
        'Checklist enviado',
        'Incidencias enviadas',
        'Datos del vuelo completos',
        'Orden de Servicio firmada',
        'Registros enviados a ELEVANT',
      ]);
      expect(requirements.every(item => item.state === 'ok' && !item.blocking && item.detail === null)).toBe(true);
      expect(handoffHoldsFor(requirements)).toEqual([]);
    });

  test.each([
    [[{ status: 'InProgress' }], 'Falta terminar 1 servicio.'],
    [[{ status: 'Planned' }, { status: 'InProgress' }, { status: 'Completed' }], 'Falta terminar 2 servicios.'],
    [[], 'La operación no tiene servicios; avisa a OCC.'],
  ])('services %j hold the hand-off: «%s»', (services, detail) => {
    expect(requirement(ready({ services }), 'services')).toEqual(expect.objectContaining({
      state: 'missing', blocking: true, detail }));
  });

  test('a service not performed or ended in an exception counts as finished', () => {
    expect(requirement(ready({ services: [{ status: 'NotPerformed' }, { status: 'Exception' }] }), 'services'))
      .toEqual(expect.objectContaining({ state: 'ok', blocking: false }));
    expect(['Completed', 'NotPerformed', 'Exception'].map(isServiceFinished)).toEqual([true, true, true]);
    expect(['Planned', 'InProgress', 'constructor', ''].map(isServiceFinished)).toEqual([false, false, false, false]);
  });

  test('a checklist ELEVANT has not received holds the hand-off and points to it', () => {
    expect(requirement(ready({ checklist: 'not-submitted' }), 'checklist')).toEqual({
      kind: 'checklist', label: 'Checklist enviado', state: 'missing', blocking: true,
      detail: 'Sin enviar: ábrelo, complétalo y envíalo.', problemCode: HANDOFF_CHECKLIST_NOT_SUBMITTED });
  });

  test('a checklist submission waiting in the queue is covered by the queue requirement', () => {
    const requirements = handoffRequirements(ready({ checklist: 'queued', waitingRecords: 1 }));
    expect(requirements.find(item => item.kind === 'checklist')).toEqual(expect.objectContaining({
      state: 'unknown', blocking: false,
      detail: 'Envío guardado en el dispositivo: sale a ELEVANT con los registros por enviar.' }));
    expect(handoffHoldsFor(requirements).map(item => item.kind)).toEqual(['queue']);
  });

  test('a checklist the tablet could not read does not hold the hand-off: the service checks it again', () => {
    expect(requirement(ready({ checklist: 'unknown' }), 'checklist')).toEqual(expect.objectContaining({
      state: 'unknown', blocking: false, detail: 'La tablet no pudo leerlo ahora; lo comprueba al entregar.' }));
  });

  test.each([
    [1, '1 incidencia sin enviar a ELEVANT: abre Incidencias.'],
    [2, '2 incidencias sin enviar a ELEVANT: abre Incidencias.'],
  ])('%i incident reports still on the device hold the hand-off', (unsentIncidents, detail) => {
    expect(requirement(ready({ unsentIncidents }), 'incidents')).toEqual(expect.objectContaining({
      state: 'missing', blocking: true, detail, problemCode: HANDOFF_PENDING_INCIDENTS }));
  });

  test('incidents the tablet could not read do not hold the hand-off', () => {
    expect(requirement(ready({ unsentIncidents: null }), 'incidents')).toEqual(expect.objectContaining({
      state: 'unknown', blocking: false, detail: 'La tablet no pudo leerlas ahora; las comprueba al entregar.' }));
  });

  test.each([
    ['without every signature', { isFullySigned: false }],
    ['signed on an earlier content', { staleRoles: ['AirlineRepresentative'] }],
  ])('a Service Order %s holds the hand-off', (_description, order) => {
    expect(requirement(ready({ documents: signed(order) }), 'serviceOrder')).toEqual(expect.objectContaining({
      state: 'missing', blocking: true, detail: 'Falta firmar la Orden de Servicio (aerolínea y AVIAM).',
      problemCode: HANDOFF_SERVICE_ORDER_UNSIGNED }));
  });

  test('before the forms are read the Service Order does not hold the hand-off', () => {
    expect(requirement(ready({ documents: undefined }), 'serviceOrder')).toEqual(expect.objectContaining({
      state: 'unknown', blocking: false, detail: 'La tablet aún no leyó los formularios; la comprueba al entregar.' }));
  });

  test.each([
    [1, 'Falta 1 registro por enviar a ELEVANT: abre Sincronización.'],
    [3, 'Faltan 3 registros por enviar a ELEVANT: abre Sincronización.'],
  ])('%i records still in the queue hold the hand-off', (waitingRecords, detail) => {
    expect(requirement(ready({ waitingRecords }), 'queue')).toEqual(expect.objectContaining({
      state: 'missing', blocking: true, detail, problemCode: HANDOFF_PENDING_QUEUE }));
  });

  test('handoffHoldsFor keeps only what holds the hand-off, in the list order', () => {
    const holds = handoffHoldsFor(handoffRequirements(ready({
      services: [{ status: 'InProgress' }], checklist: 'unknown', unsentIncidents: 1, documents: undefined,
      waitingRecords: 2,
    })));
    expect(holds.map(item => item.kind)).toEqual(['services', 'incidents', 'queue']);
  });
});

// S1 (D-S1): the Service Order was signed with «Pasajeros —» and «MTOW —» and nothing warned before the hand-off. The
// flight data now has its own row: a warning that never holds the hand-off, and no rule in the server.
describe('the flight data on the Service Order (S1, D-S1)', () => {
  const LABEL = 'Datos del vuelo completos';
  const orderWith = (summary, overrides = {}) => ({ documents: [
    { kind: 'ServiceOrder', isFullySigned: true, staleRoles: [], summary, ...overrides }] });

  test('a signed Order without passengers or MTOW warns, says it would be signed again, and holds nothing', () => {
    const requirements = handoffRequirements(ready({ documents: orderWith({ passengersIn: null, passengersOut: 138,
      mtowKg: null }) }));
    expect(requirements.find(item => item.kind === 'flightData')).toEqual({
      kind: 'flightData', label: LABEL, state: 'warning', blocking: false,
      detail: 'Faltan los pasajeros que llegan y el MTOW en la Orden. Puedes entregar sin ellos; si los guardas ahora, ' +
        'hay que volver a firmarla.' });
    expect(handoffHoldsFor(requirements)).toEqual([]);
  });

  test('one signature on the current content is enough to say so', () => {
    expect(requirement(ready({ documents: orderWith({ ...COMPLETE, mtowKg: null }, { isFullySigned: false,
      signatures: [{ role: 'AirlineRepresentative' }] }) }), 'flightData').detail)
      .toBe('Falta el MTOW en la Orden. Puedes entregar sin él; si lo guardas ahora, hay que volver a firmarla.');
  });

  test('an Order not signed yet asks to write them before signing; only its signature holds the hand-off', () => {
    const requirements = handoffRequirements(ready({ documents: orderWith({ ...COMPLETE, mtowKg: null },
      { isFullySigned: false, signatures: [] }) }));
    expect(requirements.find(item => item.kind === 'flightData')).toEqual(expect.objectContaining({
      state: 'warning', blocking: false,
      detail: 'Falta el MTOW en la Orden. Escríbelo en «Datos del vuelo» antes de firmar.' }));
    expect(handoffHoldsFor(requirements).map(item => item.kind)).toEqual(['serviceOrder']);
  });

  test('flight data saved on the device is on its way, not to be written again', () => {
    expect(requirement(ready({ documents: orderWith({ ...COMPLETE, passengersOut: null }), flightDataQueued: true }),
      'flightData').detail).toBe('Faltan los pasajeros que salen en la Orden. Lo que guardaste en «Datos del vuelo» ' +
      'llega a la Orden cuando se envíe a ELEVANT.');
  });

  test('0 passengers is a value: the flight data is complete', () => {
    expect(requirement(ready({ documents: orderWith({ passengersIn: 0, passengersOut: 0, mtowKg: 70000 }) }),
      'flightData')).toEqual({ kind: 'flightData', label: LABEL, state: 'ok', blocking: false, detail: null });
  });

  test.each([
    ['before the forms are read', undefined],
    ['with an Order read without its summary', { documents: [{ kind: 'ServiceOrder', isFullySigned: true, staleRoles: [] }] }],
    ['without a Service Order', { documents: [{ kind: 'FlightReport', isFullySigned: true, staleRoles: [], summary: COMPLETE }] }],
  ])('%s the flight data is to confirm and holds nothing', (_description, documents) => {
    expect(requirement(ready({ documents }), 'flightData')).toEqual({ kind: 'flightData', label: LABEL, state: 'unknown',
      blocking: false, detail: 'La tablet aún no leyó los datos de la Orden de Servicio.' });
  });

  test('flight data waiting in the queue counts; a refused one or another operation’s does not', () => {
    const data = (state, operationId = OPERATION_ID) => ({ idempotencyKey: '91000000-0000-4000-8000-000000000004',
      state, attempts: 0, createdAt: '2026-10-05T14:30:00.000Z', command: { kind: 'flightData', operationId,
        passengersIn: 142, passengersOut: 138, mtowKg: 78000, aircraftRegistration: null } });
    expect(flightDataQueuedFor([data('pending')], OPERATION_ID.toUpperCase())).toBe(true);
    expect(flightDataQueuedFor([data('blocked')], OPERATION_ID)).toBe(false);
    expect(flightDataQueuedFor([data('pending', '70000000-0000-4000-8000-000000000009')], OPERATION_ID)).toBe(false);
    expect(flightDataQueuedFor([], OPERATION_ID)).toBe(false);
  });
});

describe('where the checklist stands (N1)', () => {
  test.each([
    ['sent, read from ELEVANT', { status: 'Submitted', fromCache: false }, false, 'submitted'],
    // ELEVANT never takes a sent checklist back, so a saved copy that says «sent» is still right.
    ['sent, from the saved copy', { status: 'Submitted', fromCache: true }, false, 'submitted'],
    ['answered but not sent', { status: 'InProgress', fromCache: false }, false, 'not-submitted'],
    ['not started', { status: 'NotStarted', fromCache: false }, false, 'not-submitted'],
    ['not sent, its submission in the queue', { status: 'InProgress', fromCache: false }, true, 'queued'],
    ['not read', null, true, 'queued'],
    // A saved copy may be behind: what it says is not sent may have reached ELEVANT since.
    ['not sent, from the saved copy', { status: 'NotStarted', fromCache: true }, false, 'unknown'],
    ['not read, nothing queued', null, false, 'unknown'],
  ])('%s: %s', (_description, read, queued, standing) => {
    expect(checklistStanding(read, queued)).toBe(standing);
  });

  test('a submission of the operation’s checklist waiting in the queue counts; a refused one or another operation’s does not', () => {
    const submission = (state, operationId = OPERATION_ID) => ({ idempotencyKey: '91000000-0000-4000-8000-000000000003',
      state, attempts: 0, createdAt: '2026-10-05T14:30:00.000Z',
      command: { kind: 'checklistSubmit', operationId, checklistId: '72000000-0000-4000-8000-000000000001', answers: [] } });
    expect(checklistQueuedFor([submission('pending')], OPERATION_ID.toUpperCase())).toBe(true);
    expect(checklistQueuedFor([submission('blocked')], OPERATION_ID)).toBe(false);
    expect(checklistQueuedFor([submission('pending', '70000000-0000-4000-8000-000000000009')], OPERATION_ID)).toBe(false);
    expect(checklistQueuedFor([], OPERATION_ID)).toBe(false);
  });
});

describe('the tablet’s own reasons to wait (3-N06, N1)', () => {
  test('the four local codes are «Entrega en espera»; any other is not', () => {
    expect([HANDOFF_PENDING_QUEUE, HANDOFF_SERVICE_ORDER_UNSIGNED, HANDOFF_CHECKLIST_NOT_SUBMITTED,
      HANDOFF_PENDING_INCIDENTS]).toEqual(['pending_queue', 'service_order_unsigned', 'checklist_not_submitted',
      'pending_incidents']);
    expect([HANDOFF_PENDING_QUEUE, HANDOFF_SERVICE_ORDER_UNSIGNED, HANDOFF_CHECKLIST_NOT_SUBMITTED,
      HANDOFF_PENDING_INCIDENTS].every(isHandoffHold)).toBe(true);
    expect([undefined, 'contract_not_in_force', 'constructor', ''].some(isHandoffHold)).toBe(false);
  });
});
