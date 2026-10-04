import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningVsExecution from './PlanningVsExecution';

function buildOperation(overrides = {}) {
  return {
    planned: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    actual: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    ...overrides,
  };
}

describe('PlanningVsExecution', () => {
  it('shows "Coincide" for every field when planned matches actual', () => {
    render(<PlanningVsExecution operation={buildOperation()} />);
    expect(screen.getAllByText('Coincide').length).toBe(7);
  });

  it('highlights a critical discrepancy with the correct label', () => {
    const operation = buildOperation({ actual: { ...buildOperation().actual, agents: 4 } });
    render(<PlanningVsExecution operation={operation} />);
    expect(screen.getByText('Discrepancia crítica')).toBeInTheDocument();
  });
});