import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewHeader from './ReviewHeader';

describe('ReviewHeader', () => {
  it('renders the title and description', () => {
    render(<ReviewHeader onRefresh={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Revisión' })).toBeInTheDocument();
    expect(screen.getByText(/revise y valide las operaciones/i)).toBeInTheDocument();
  });

  it('calls onRefresh when the Actualizar button is clicked', async () => {
    const onRefresh = vi.fn();
    render(<ReviewHeader onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables the Exportar action', () => {
    render(<ReviewHeader onRefresh={() => {}} />);
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled();
  });
});