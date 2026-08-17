import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightSearch from './FlightSearch';

describe('FlightSearch', () => {
  it('renders the current value and calls onChange as the user types', async () => {
    const onChange = vi.fn();
    render(<FlightSearch value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Número, aerolínea, matrícula o supervisor');
    await userEvent.type(input, 'DM161');
    expect(onChange).toHaveBeenCalledWith('D');
    expect(onChange).toHaveBeenCalledTimes(5);
  });
});
