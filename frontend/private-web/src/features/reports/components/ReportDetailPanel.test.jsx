import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReportDetailPanel from './ReportDetailPanel';

const RECORD = {
  flight: { number: 'DM161', airline: 'Arajet' },
  terminal: 'Terminal A',
  aircraftType: 'B737 MAX 8',
  position: { assigned: 'B19', final: 'B21' },
  agent: { name: 'Carlos Medina' },
  positionChange: { changeReceivedAt: '2026-08-05T09:18:00-04:00' },
  actualBlockAt: '2026-08-05T09:50:00-04:00',
  groundTime: { contractedMinutes: 60, actualMinutes: 58 },
  services: [{ name: 'GPU', contractedQty: 1, executedQty: 1 }],
  incidents: 2,
};

describe('ReportDetailPanel', () => {
  it('renders nothing when there is no record', () => {
    const { container } = render(<ReportDetailPanel record={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows flight, position-change, ground time, services and incidents sections', () => {
    render(<ReportDetailPanel record={RECORD} />);
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('Cambio de posición')).toBeInTheDocument();
    expect(screen.getByText('60 min')).toBeInTheDocument();
    expect(screen.getByText('GPU')).toBeInTheDocument();
    expect(screen.getByText(/2 incidencias reportadas/)).toBeInTheDocument();
  });

  it('omits the position-change section when there was none', () => {
    render(<ReportDetailPanel record={{ ...RECORD, positionChange: null }} />);
    expect(screen.queryByText('Cambio de posición')).not.toBeInTheDocument();
  });

  it('shows no incidents copy when there are none', () => {
    render(<ReportDetailPanel record={{ ...RECORD, incidents: 0 }} />);
    expect(screen.getByText('Sin incidencias reportadas.')).toBeInTheDocument();
  });

  it('never renders approve or return actions', () => {
    render(<ReportDetailPanel record={RECORD} />);
    expect(screen.queryByRole('button', { name: /aprobar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /devolver/i })).not.toBeInTheDocument();
  });
});
