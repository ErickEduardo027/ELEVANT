import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ReconciliationSummaryTable from './ReconciliationSummaryTable';

function buildRow(overrides = {}) {
  return {
    id: 'OP-1-svc-0',
    airline: 'Arajet',
    flight: 'DM161',
    terminal: 'Terminal A',
    period: '2026-08-05',
    service: 'GPU',
    contractedQty: 1,
    executedQty: 2,
    diff: 1,
    status: 'diferencia',
    detail: {
      flight: { number: 'DM161', airline: 'Arajet' },
      terminal: 'Terminal A',
      aircraftType: 'B737 MAX 8',
      position: { assigned: 'A5', final: 'A5' },
      agent: { name: 'Carlos Medina' },
      positionChange: null,
      actualBlockAt: '2026-08-05T10:06:00-04:00',
      groundTime: { contractedMinutes: 75, actualMinutes: 78 },
      services: [{ name: 'GPU', contractedQty: 1, executedQty: 2 }],
      incidents: 0,
    },
    ...overrides,
  };
}

describe('ReconciliationSummaryTable', () => {
  it('shows contracted vs executed quantities and the reconciliation status', () => {
    render(<ReconciliationSummaryTable rows={[buildRow()]} />);
    expect(screen.getByText('GPU')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(within(screen.getByTestId('report-table-row')).getByText('Diferencia')).toBeInTheDocument();
  });

  it('highlights rows where the contracted service was never executed', () => {
    render(<ReconciliationSummaryTable rows={[buildRow({ status: 'no_ejecutado', executedQty: 0, diff: -1 })]} />);
    expect(screen.getByTestId('report-table-row').className).toMatch(/status-danger/);
  });
});
