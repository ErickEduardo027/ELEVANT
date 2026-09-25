import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlyAwareStatusPanel from './FlyAwareStatusPanel';

describe('FlyAwareStatusPanel', () => {
  it('shows the online message with minutes since last sync', () => {
    render(<FlyAwareStatusPanel status="online" lastSyncMinutesAgo={2} />);
    expect(screen.getByText(/en línea/i)).toBeInTheDocument();
    expect(screen.getByText(/hace 2 min/i)).toBeInTheDocument();
  });

  it('shows a degraded message', () => {
    render(<FlyAwareStatusPanel status="degraded" lastSyncMinutesAgo={9} />);
    expect(screen.getByText(/con demoras/i)).toBeInTheDocument();
  });

  it('shows a disconnected error message', () => {
    render(<FlyAwareStatusPanel status="error" lastSyncMinutesAgo={40} />);
    expect(screen.getByText(/sin conexión/i)).toBeInTheDocument();
    expect(screen.getByText(/hace 40 min/i)).toBeInTheDocument();
  });

  it('announces status changes politely for screen readers', () => {
    render(<FlyAwareStatusPanel status="error" lastSyncMinutesAgo={40} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('handles unrecognized status gracefully with fallback treatment', () => {
    render(<FlyAwareStatusPanel status="unknown" lastSyncMinutesAgo={15} />);
    expect(screen.getByText(/fuente aeronáutica no conectada/i)).toBeInTheDocument();
    expect(screen.getByText(/hace 15 min/i)).toBeInTheDocument();
  });

  it('does not invent a synchronization time when no provider is connected', () => {
    render(<FlyAwareStatusPanel status="unavailable" lastSyncMinutesAgo={null} />);
    expect(screen.getByText(/sin sincronización verificada/i)).toBeInTheDocument();
  });
});
