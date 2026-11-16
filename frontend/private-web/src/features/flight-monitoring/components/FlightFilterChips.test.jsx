import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightFilterChips from './FlightFilterChips';

describe('FlightFilterChips', () => {
  it('renders all seven chips and marks the active one pressed', () => {
    render(<FlightFilterChips active="delayed" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retrasados' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the chip id when clicked', async () => {
    const onChange = vi.fn();
    render(<FlightFilterChips active="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'En ruta' }));
    expect(onChange).toHaveBeenCalledWith('enRoute');
  });
});