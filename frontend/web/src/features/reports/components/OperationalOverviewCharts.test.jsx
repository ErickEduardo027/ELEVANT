import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import OperationalOverviewCharts from './OperationalOverviewCharts';

const RECORDS = [
  {
    flight: { number: 'DM161', airline: 'Arajet' },
    agent: { name: 'Carlos Medina' },
    date: '2026-08-05',
    flightStatus: 'arrived',
    services: [{ name: 'GPU', contractedQty: 1, executedQty: 1 }],
  },
  {
    flight: { number: 'AA904', airline: 'American Airlines' },
    agent: { name: 'María Castillo' },
    date: '2026-08-05',
    flightStatus: 'delayed',
    services: [{ name: 'Baggage', contractedQty: 1, executedQty: 1 }],
  },
];

describe('OperationalOverviewCharts', () => {
  it('renders the four operational charts', () => {
    render(<OperationalOverviewCharts records={RECORDS} />);
    expect(screen.getByText('Vuelos atendidos por período')).toBeInTheDocument();
    expect(screen.getByText('Distribución de vuelos por estado')).toBeInTheDocument();
    expect(screen.getByText('Servicios ejecutados por tipo')).toBeInTheDocument();
    expect(screen.getByText('Carga operativa por agente')).toBeInTheDocument();
    expect(screen.getByText('Carlos Medina')).toBeInTheDocument();
    expect(screen.getByText('GPU')).toBeInTheDocument();
  });
});
