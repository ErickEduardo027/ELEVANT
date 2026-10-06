import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningKPIs from './PlanningKPIs';
import * as countUpModule from '../../../hooks/useCountUp';

const KPIS = {
  turnarounds: 4,
  flightLegs: 7,
  pendingAssignment: 2,
  positionsAssigned: 3,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlanningKPIs', () => {
  it('renders only metrics that can be derived truthfully from the read model', () => {
    vi.spyOn(countUpModule, 'useCountUp').mockImplementation(value => value);
    render(<PlanningKPIs kpis={KPIS} />);

    expect(screen.getByText('Escalas operativas')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Tramos de vuelo')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Pendientes de recursos')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Posiciones asignadas')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/conflictos/i)).not.toBeInTheDocument();
  });

  it('renders skeletons for every card while loading', () => {
    render(<PlanningKPIs kpis={KPIS} loading />);

    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
  });
});