import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewEmptyState from './ReviewEmptyState';

describe('ReviewEmptyState', () => {
  it('shows the pending-tab copy when there are no active filters', () => {
    render(<ReviewEmptyState activeTab="pending" hasActiveFilters={false} />);
    expect(screen.getByText('No hay operaciones pendientes de revisión.')).toBeInTheDocument();
  });

  it('shows the no-results copy when filters are active, regardless of tab', () => {
    render(<ReviewEmptyState activeTab="pending" hasActiveFilters />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('shows tailored copy for the returned tab', () => {
    render(<ReviewEmptyState activeTab="returned" hasActiveFilters={false} />);
    expect(screen.getByText('No hay operaciones devueltas.')).toBeInTheDocument();
  });
});
