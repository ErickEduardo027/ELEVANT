import { expect, it } from 'vitest';
import { reasonTexts, withAssignmentReadiness } from './planningMappers';

const label = reason => `[${reason}]`;
const missing = names => `Le falta: ${names}`;

// ADR-0045: «Le falta: …» names the permits the flight's stand requires.
it('names the missing permits and keeps the other reasons', () => {
  expect(reasonTexts(['shift_not_compatible', 'required_permit_missing'], ['Carnet de zona restringida'], label, missing))
    .toEqual(['[shift_not_compatible]', 'Le falta: Carnet de zona restringida']);
  expect(reasonTexts(['required_permit_missing'], undefined, label, missing)).toEqual(['[required_permit_missing]']);
});

it('carries the missing permits of an unfit assignment to its agent', () => {
  const flights = [{ id: 'f1', assignedAgents: [{ assignmentId: 'A1', displayName: 'Riley' }] }];
  const [flight] = withAssignmentReadiness(flights, { assignments: [{ assignmentId: 'a1', reasons: ['required_permit_missing'],
    missingPermits: ['Carnet de zona restringida'] }] });
  expect(flight.assignedAgents[0]).toMatchObject({ unfitReasons: ['required_permit_missing'],
    missingPermits: ['Carnet de zona restringida'] });
});
