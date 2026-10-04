import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import GroundTimeTable from './GroundTimeTable';

function buildRow(overrides = {}) {
  return {
    id: 'OP-1-gt',
    flight: { number: 'DL2210', airline: 'Delta Air Lines' },
    terminal: 'Terminal B',
    date: '2026-08-05',
    aircraftType: 'A321neo',
    contractedMinutes: 50,
    actualMinutes: 62,
    diffMinutes: 12,
    status: 'exceeded',
    detail: {
      flight: { number: 'DL2210', airline: 'Delta Air Lines' },
      terminal: 'Terminal B',
      aircraftType: 'A321neo',
      position: { assigned: 'B18', final: 'B21' },
      agent: { name: 'Rafael Peña' },
      positionChange: { changeReceivedAt: '2026-08-05T12:12:00-04:00' },
      actualBlockAt: '2026-08-05T12:25:00-04:00',
      groundTime: { contractedMinutes: 50, actualMinutes: 62 },
      services: [{ name: 'GPU', contractedQty: 1, executedQty: 1 }],
      incidents: 1,
    },
    ...overrides,
  };
}

describe('GroundTimeTable', () => {
  it('shows contracted and actual ground time with the SLA status', () => {
    render(<GroundTimeTable rows={[buildRow()]} />);
    expect(screen.getByText('50 min')).toBeInTheDocument();
    expect(screen.getByText('62 min')).toBeInTheDocument();
    expect(screen.getByText('+12 min')).toBeInTheDocument();
    expect(screen.getByText('Excedido')).toBeInTheDocument();
  });

  it('highlights rows that exceeded the contracted ground time', () => {
    render(<GroundTimeTable rows={[buildRow()]} />);
    expect(screen.getByTestId('report-table-row').className).toMatch(/status-danger/);
  });

  it('does not highlight rows within SLA', () => {
    render(<GroundTimeTable rows={[buildRow({ status: 'within_sla', diffMinutes: -5, actualMinutes: 45 })]} />);
    expect(screen.getByTestId('report-table-row').className).not.toMatch(/status-danger/);
  });
});