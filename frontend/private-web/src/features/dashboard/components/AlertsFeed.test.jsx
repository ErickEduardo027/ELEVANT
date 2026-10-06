import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AlertsFeed from './AlertsFeed';

const ALERTS = Array.from({ length: 8 }, (_, i) => ({
  id: `alert-${i}`,
  severity: 'warning',
  message: `Alerta número ${i}`,
  occurredAt: '2026-08-01T13:50:00-04:00',
}));

describe('AlertsFeed', () => {
  it('renders at most 6 alerts even if more are passed', () => {
    render(<AlertsFeed alerts={ALERTS} />);
    expect(screen.getAllByTestId('flight-strip')).toHaveLength(6);
  });

  it('renders a scrollable container', () => {
    render(<AlertsFeed alerts={ALERTS} />);
    expect(screen.getByTestId('alerts-scroll')).toHaveClass('overflow-y-auto');
  });

  it('renders the alert message text', () => {
    render(<AlertsFeed alerts={[ALERTS[0]]} />);
    expect(screen.getByText('Alerta número 0')).toBeInTheDocument();
  });

  it('renders a skeleton list when loading', () => {
    render(<AlertsFeed alerts={[]} loading />);
    expect(screen.getByTestId('alerts-skeleton')).toBeInTheDocument();
  });
});