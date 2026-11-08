// 3-G: OCC takes the agent's incidents into review, resolves them or closes them while the flight is on the ramp; the
// tablet reads each state in Spanish and never shows its code.
jest.mock('../src/utils/date-format', () => ({ dateTimeFormat: () => ({ format: () => '' }) }));

const { incidentStatusLabel } = require('../src/features/assigned-operations/presentation');

describe('incident status labels (3-G)', () => {
  test('every state OCC sets reads in Spanish', () => {
    expect(['Open', 'InReview', 'Resolved', 'Closed'].map(incidentStatusLabel))
      .toEqual(['Registrada', 'En revisión de OCC', 'Resuelta', 'Cerrada']);
  });

  test('a state this version does not know is never shown as its code', () => {
    expect(incidentStatusLabel('Escalated')).toBe('Estado por confirmar');
    expect(incidentStatusLabel('constructor')).toBe('Estado por confirmar');
  });
});
