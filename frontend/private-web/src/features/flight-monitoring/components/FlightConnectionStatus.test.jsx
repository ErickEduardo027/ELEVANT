import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightConnectionStatus from './FlightConnectionStatus';

describe('FlightConnectionStatus', () => {
  it('shows the connected title when connection is connected', () => {
    render(<FlightConnectionStatus connection="connected" lastUpdatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText('FlyAware conectado')).toBeInTheDocument();
  });

  it('shows the disconnected title and a ring style when connection is disconnected', () => {
    render(<FlightConnectionStatus connection="disconnected" lastUpdatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText('FlyAware desconectado')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveClass('ring-1');
  });

  it('shows a placeholder when there has been no update yet', () => {
    render(<FlightConnectionStatus connection="syncing" lastUpdatedAt={null} onRefresh={() => {}} />);
    expect(screen.getByText('Sin actualizaciones aún')).toBeInTheDocument();
  });

  it('shows a formatted last-updated time when available', () => {
    render(<FlightConnectionStatus connection="connected" lastUpdatedAt="2026-08-06T08:05:00-04:00" onRefresh={() => {}} />);
    expect(screen.getByText(/Última actualización \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('calls onRefresh when the button is clicked', async () => {
    const onRefresh = vi.fn();
    render(<FlightConnectionStatus connection="connected" lastUpdatedAt={null} onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});