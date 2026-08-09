import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import KpiCard from './KpiCard';
import { PlaneIcon } from './icons';
import * as countUpModule from '../useCountUp';

describe('KpiCard', () => {
  it('renders the label and the count-up value', () => {
    vi.spyOn(countUpModule, 'useCountUp').mockReturnValue(42);
    render(<KpiCard label="Vuelos programados hoy" value={42} icon={PlaneIcon} />);
    expect(screen.getByText('Vuelos programados hoy')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders a custom visual instead of the numeric value when provided', () => {
    render(
      <KpiCard
        label="Servicios"
        value={0}
        icon={PlaneIcon}
        visual={<div data-testid="custom-visual" />}
      />
    );
    expect(screen.getByTestId('custom-visual')).toBeInTheDocument();
  });

  it('renders a skeleton instead of content when loading', () => {
    render(<KpiCard label="Vuelos programados hoy" value={42} icon={PlaneIcon} loading />);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Vuelos programados hoy')).not.toBeInTheDocument();
  });

  it('applies the signal color to the value when tone is signal', () => {
    vi.spyOn(countUpModule, 'useCountUp').mockReturnValue(4);
    render(<KpiCard label="Aprobaciones pendientes" value={4} icon={PlaneIcon} tone="signal" />);
    expect(screen.getByText('4')).toHaveClass('text-signal-500');
  });
});
