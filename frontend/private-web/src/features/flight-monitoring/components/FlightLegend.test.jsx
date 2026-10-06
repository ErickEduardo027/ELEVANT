import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightLegend from './FlightLegend';

describe('FlightLegend', () => {
  it('lists every flight status label', () => {
    render(<FlightLegend />);
    expect(screen.getByText('Programado')).toBeInTheDocument();
    expect(screen.getByText('Aproximando')).toBeInTheDocument();
    expect(screen.getByText('Desconocido')).toBeInTheDocument();
  });

  it('is expanded by default and collapses when its header is clicked', async () => {
    render(<FlightLegend />);
    expect(screen.getByRole('button', { name: /Leyenda/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Programado')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /Leyenda/ }));
    expect(screen.getByRole('button', { name: /Leyenda/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Programado')).not.toBeInTheDocument();
  });
});