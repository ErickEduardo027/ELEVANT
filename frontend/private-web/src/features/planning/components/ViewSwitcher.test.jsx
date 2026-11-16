import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewSwitcher from './ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders the three view tabs', () => {
    render(<ViewSwitcher active="timeline" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tabla' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calendario' })).toBeInTheDocument();
  });

  it('marks the active view as selected', () => {
    render(<ViewSwitcher active="table" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Tabla' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the clicked view id', async () => {
    const onChange = vi.fn();
    render(<ViewSwitcher active="timeline" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Calendario' }));
    expect(onChange).toHaveBeenCalledWith('calendar');
  });
});