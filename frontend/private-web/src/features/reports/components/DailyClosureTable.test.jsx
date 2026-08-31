import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DailyClosureTable from './DailyClosureTable';

function buildRow(overrides = {}) {
  return {
    id: 'OP-1-closure',
    flight: { number: 'DM161', airline: 'Arajet' },
    terminal: 'Terminal A',
    date: '2026-08-05',
    initialPosition: 'B19',
    finalPosition: 'B21',
    changeReceivedAt: '2026-08-05T09:18:00-04:00',
    actualBlockAt: '2026-08-05T09:50:00-04:00',
    leadTimeMinutes: 32,
    agent: { name: 'Carlos Medina' },
    severity: 'normal',
    incidents: 0,
    detail: {
      flight: { number: 'DM161', airline: 'Arajet' },
      terminal: 'Terminal A',
      aircraftType: 'B737 MAX 8',
      position: { assigned: 'B19', final: 'B21' },
      agent: { name: 'Carlos Medina' },
      positionChange: { changeReceivedAt: '2026-08-05T09:18:00-04:00' },
      actualBlockAt: '2026-08-05T09:50:00-04:00',
      groundTime: { contractedMinutes: 60, actualMinutes: 58 },
      services: [{ name: 'GPU', contractedQty: 1, executedQty: 1 }],
      incidents: 0,
    },
    ...overrides,
  };
}

describe('DailyClosureTable', () => {
  it('shows the flight, positions, lead time and severity for each row', () => {
    render(<DailyClosureTable rows={[buildRow()]} />);
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('B19')).toBeInTheDocument();
    expect(screen.getByText('B21')).toBeInTheDocument();
    expect(screen.getByText('32 min')).toBeInTheDocument();
    expect(screen.getByText('Margen suficiente')).toBeInTheDocument();
  });

  it('highlights critical rows', () => {
    render(<DailyClosureTable rows={[buildRow({ severity: 'critical' })]} />);
    expect(screen.getByTestId('report-table-row').className).toMatch(/status-danger/);
    expect(screen.getByText('Situación crítica')).toBeInTheDocument();
  });

  it('expands a row into a read-only detail panel with no approve/return actions', async () => {
    render(<DailyClosureTable rows={[buildRow()]} />);
    await userEvent.click(screen.getByTestId('report-table-row'));
    expect(screen.getByText('Información del vuelo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /aprobar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /devolver/i })).not.toBeInTheDocument();
  });
});
