import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ViewSwitcher from './ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders the three view tabs', () => {
    render(<ViewSwitcher active="timeline" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tabla' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Calendario' })).toBeInTheDocument();
  });

  it('marks the active view as selected', () => {
    render(<ViewSwitcher active="table" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Tabla' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked view id', async () => {
    const onChange = vi.fn();
    render(<ViewSwitcher active="timeline" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Calendario' }));
    expect(onChange).toHaveBeenCalledWith('calendar');
  });
});
