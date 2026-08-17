import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningKPIs from './PlanningKPIs';
import * as countUpModule from '../../../hooks/useCountUp';

const KPIS = { flightsToday: 20, pendingAssignment: 9, positionsOccupied: 5, conflicts: 2 };

describe('PlanningKPIs', () => {
  it('renders all four KPI labels with their values', () => {
    vi.spyOn(countUpModule, 'useCountUp').mockImplementation(value => value);
    render(<PlanningKPIs kpis={KPIS} />);
    expect(screen.getByText('Vuelos del día')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Pendientes de asignación')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('Posiciones ocupadas')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Conflictos detectados')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders skeletons for every card when loading', () => {
    render(<PlanningKPIs kpis={KPIS} loading />);
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
  });
});
