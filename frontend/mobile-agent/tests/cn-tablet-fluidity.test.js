// CN-21: the tablet shows a stand as OCC's map does («A1», never «A01»), with the rule the API and AVIAM Web share
// (ADR-0041); the cases are the file the C# and the web tests read too.
// CN-25: the assignment's position in Spanish («Agente de rampa») by its code, the server's name otherwise.
// CN-22: the operation's tabs say their progress from the hand-off's own requirements.
// CN-24: while the push-back is not recorded, the Service Order and the close warn that signing first means signing
// again; nothing is held.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { normalizeStandCode, standDisplayCode } = require('../src/utils/stand-codes');
const {
  assignmentPositionLabel,
  operationStandLabel,
} = require('../src/features/assigned-operations/presentation');
const { handoffHoldsFor, handoffRequirements } = require('../src/features/assigned-operations/handoff');
const { operationTabProgress, OPERATION_TABS } = require('../src/features/assigned-operations/operation-tabs');
const { PUSHBACK_BEFORE_SIGNING, isPushbackRecorded } = require('../src/features/assigned-operations/pushback-recorded');

const vectors = JSON.parse(readFileSync(
  path.join(__dirname, '../../../backend/Elevant.Application/Operations/StandCodes.vectors.json'), 'utf8'));

describe('stand codes (CN-21, ADR-0041)', () => {
  test('normalizes every shared vector, as the API and AVIAM Web do', () => {
    expect(vectors.normalize.length).toBeGreaterThan(10);
    for (const { input, expected } of vectors.normalize) {
      expect(normalizeStandCode(input)).toBe(expected);
      expect(normalizeStandCode(expected)).toBe(expected);
    }
    for (const [left, right] of vectors.distinct) {
      expect(normalizeStandCode(left)).not.toBe(normalizeStandCode(right));
    }
  });

  test('shows a stand without the zero padding of its number, as the map draws it', () => {
    expect(['A01', 'A02', 'B01', 'AN01', 'BN06', 'A010', 'A001', 'A00', '09A', 'A01B'].map(standDisplayCode))
      .toEqual(['A1', 'A2', 'B1', 'AN1', 'BN6', 'A10', 'A1', 'A0', '9A', 'A1B']);
    expect(['A1', 'A3', 'A10', 'A0', 'AN1', 'B20', 'FBO', '1', '9A', '23A'].map(standDisplayCode))
      .toEqual(['A1', 'A3', 'A10', 'A0', 'AN1', 'B20', 'FBO', '1', '9A', '23A']);
    expect(standDisplayCode('E2E-XXXX-1')).toBe('E2E-XXXX-1');
    expect(standDisplayCode(null)).toBe('');
    expect(standDisplayCode(undefined)).toBe('');
  });

  test('names the stand the shared rule names, never a third code', () => {
    for (const { input, expected } of vectors.normalize) {
      const shown = standDisplayCode(input);
      expect([input, expected]).toContain(shown);
      expect(normalizeStandCode(shown)).toBe(expected);
    }
  });

  test('the operation shows «A1» and «T1 · A2» where the seed stored «A01» and «A02»', () => {
    const withStand = stand => ({ turnaround: { stand } });
    expect(operationStandLabel(withStand({ code: 'A01', terminal: null }))).toBe('A1');
    expect(operationStandLabel(withStand({ code: 'A02', terminal: { code: 'T1' } }))).toBe('T1 · A2');
    expect(operationStandLabel(withStand({ code: 'A3', terminal: null }))).toBe('A3');
    expect(operationStandLabel(withStand(null))).toBe('Stand por confirmar');
  });
});

describe('the assignment position in Spanish (CN-25)', () => {
  test('RAMP-AGENT reads «Agente de rampa», whatever the catalog names it', () => {
    expect(assignmentPositionLabel({ id: 'x', code: 'RAMP-AGENT', name: 'Ramp agent' })).toBe('Agente de rampa');
    expect(assignmentPositionLabel({ id: 'x', code: 'ramp-agent', name: 'Ramp agent' })).toBe('Agente de rampa');
  });

  test('a position this version does not know keeps the name the server sends', () => {
    expect(assignmentPositionLabel({ id: 'x', code: 'BAG-LEAD', name: 'Líder de equipaje' })).toBe('Líder de equipaje');
    expect(assignmentPositionLabel(null)).toBeNull();
    expect(assignmentPositionLabel(undefined)).toBeNull();
  });
});

const COMPLETE = { passengersIn: 142, passengersOut: 138, mtowKg: 78000 };
const forms = (order = {}) => ({ documents: [
  { kind: 'ServiceOrder', isFullySigned: false, staleRoles: [], signatures: [], summary: COMPLETE, ...order },
] });

function requirementsFor(overrides = {}) {
  return handoffRequirements({
    services: [{ status: 'Completed' }, { status: 'InProgress' }, { status: 'Planned' }],
    checklist: 'not-submitted',
    unsentIncidents: 0,
    documents: forms(),
    waitingRecords: 0,
    ...overrides,
  });
}

describe('tab progress (CN-22)', () => {
  test('five tabs, in the order of the work', () => {
    expect(OPERATION_TABS.map(tab => tab.label)).toEqual(['Resumen', 'Vuelo', 'Servicios', 'Documentos', 'Cierre']);
  });

  test('says the services finished, the Order to sign and what the close still lacks', () => {
    const requirements = requirementsFor();
    const progress = operationTabProgress({ requirements, services: [{ status: 'Completed' },
      { status: 'InProgress' }, { status: 'Planned' }], returned: false, closed: false });
    expect(progress.servicios).toEqual({ hint: '1/3', tone: 'pending', spoken: '1 de 3 terminados' });
    expect(progress.documentos).toEqual(expect.objectContaining({ hint: 'Firmar', tone: 'pending' }));
    expect(progress.vuelo).toEqual(expect.objectContaining({ hint: '✓', tone: 'done' }));
    // Services, checklist and the Order hold the hand-off: 3 of the 6 requirements are met.
    expect(handoffHoldsFor(requirements)).toHaveLength(3);
    expect(progress.cierre).toEqual({ hint: '3/6', tone: 'pending', spoken: '3 requisitos pendientes para entregar' });
    expect(progress.resumen).toEqual({ hint: null, tone: null, spoken: null });
  });

  test('«Cierre ✓» once nothing holds the hand-off, and the services «5/5»', () => {
    const services = Array.from({ length: 5 }, () => ({ status: 'Completed' }));
    const requirements = requirementsFor({ services, checklist: 'submitted',
      documents: forms({ isFullySigned: true, signatures: [{}] }) });
    const progress = operationTabProgress({ requirements, services, returned: false, closed: false });
    expect(progress.servicios).toEqual(expect.objectContaining({ hint: '5/5', tone: 'done' }));
    expect(progress.documentos).toEqual(expect.objectContaining({ hint: '✓', tone: 'done' }));
    expect(progress.cierre).toEqual(expect.objectContaining({ hint: '✓', tone: 'done' }));
  });

  test('what the tablet cannot tell gets no hint; a returned operation marks its summary', () => {
    const requirements = requirementsFor({ documents: undefined });
    const progress = operationTabProgress({ requirements, services: [], returned: true, closed: false });
    expect(progress.servicios.hint).toBeNull();
    expect(progress.documentos.hint).toBeNull();
    expect(progress.vuelo.hint).toBeNull();
    expect(progress.resumen).toEqual(expect.objectContaining({ hint: '!', tone: 'warning' }));
  });

  test('missing flight data warns on «Vuelo»; a closed execution is «Cierre ✓»', () => {
    const requirements = requirementsFor({ documents: forms({ summary: { passengersIn: null, passengersOut: 1,
      mtowKg: 1 } }) });
    const progress = operationTabProgress({ requirements, services: [], returned: false, closed: true });
    expect(progress.vuelo).toEqual(expect.objectContaining({ hint: '!', tone: 'warning' }));
    expect(progress.cierre).toEqual(expect.objectContaining({ hint: '✓', tone: 'done' }));
  });
});

const OPERATION_ID = '70000000-0000-4000-8000-000000000005';
const pushbackItem = (state, operationId = OPERATION_ID) => ({ state, command: { kind: 'milestone', operationId,
  code: 'PUSHBACK', occurredAt: '2026-11-24T12:00:00Z' } });

describe('push-back before signing (CN-24)', () => {
  test('the push-back is recorded when ELEVANT has it or it waits on the device; a refused one is not', () => {
    const base = { items: [], operationId: OPERATION_ID };
    expect(isPushbackRecorded(base)).toBe(false);
    expect(isPushbackRecorded({ ...base, milestones: [{ code: 'BLOCK_ON' }] })).toBe(false);
    expect(isPushbackRecorded({ ...base, milestones: [{ code: 'PUSHBACK' }] })).toBe(true);
    expect(isPushbackRecorded({ ...base, confirmed: [{ code: 'PUSHBACK' }] })).toBe(true);
    expect(isPushbackRecorded({ ...base, items: [pushbackItem('pending', OPERATION_ID.toUpperCase())] })).toBe(true);
    expect(isPushbackRecorded({ ...base, items: [pushbackItem('blocked')] })).toBe(false);
    expect(isPushbackRecorded({ ...base, items: [pushbackItem('pending', '70000000-0000-4000-8000-000000000099')] }))
      .toBe(false);
  });

  test('the close warns on the Order still to sign, without holding anything more', () => {
    const before = requirementsFor({ pushbackRecorded: false });
    const order = before.find(item => item.kind === 'serviceOrder');
    expect(order.detail).toBe(`Falta firmar la Orden de Servicio (aerolínea y AVIAM). ${PUSHBACK_BEFORE_SIGNING}`);
    expect(PUSHBACK_BEFORE_SIGNING).toBe('Registra el push-back antes de firmar: al registrarlo cambia la hora de ' +
      'salida y habrá que firmar de nuevo.');
    expect(handoffHoldsFor(before).map(item => item.kind))
      .toEqual(handoffHoldsFor(requirementsFor()).map(item => item.kind));

    const after = requirementsFor({ pushbackRecorded: true }).find(item => item.kind === 'serviceOrder');
    expect(after.detail).toBe('Falta firmar la Orden de Servicio (aerolínea y AVIAM).');
    const signed = requirementsFor({ pushbackRecorded: false, documents: forms({ isFullySigned: true }) })
      .find(item => item.kind === 'serviceOrder');
    expect(signed).toEqual(expect.objectContaining({ state: 'ok', detail: null }));
  });
});
