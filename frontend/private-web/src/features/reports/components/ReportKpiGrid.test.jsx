import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReportKpiGrid from './ReportKpiGrid';

const KPIS = { flightsHandled: 42, servicesExecuted: 96, incidentOperations: 3, avgGroundTimeMinutes: 68, slaCompliancePct: 92 };

describe('ReportKpiGrid', () => {
  it('renders every summary KPI with its unit-formatted value', () => {
    render(<ReportKpiGrid kpis={KPIS} />);
    expect(screen.getByText('Vuelos atendidos')).toBeInTheDocument();
    expect(screen.getByText('Servicios ejecutados')).toBeInTheDocument();
    expect(screen.getByText('Operaciones con incidencias')).toBeInTheDocument();
    expect(screen.getByText('68 min')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    render(<ReportKpiGrid kpis={KPIS} loading />);
    expect(screen.getAllByTestId('kpi-skeleton').length).toBe(5);
  });
});