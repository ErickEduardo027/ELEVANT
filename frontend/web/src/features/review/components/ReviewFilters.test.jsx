import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewFilters from './ReviewFilters';

const FILTERS = {
  airline: '',
  agent: '',
  supervisor: '',
  position: '',
  serviceType: '',
  flightNumber: '',
  orderReference: '',
  dateFrom: '',
  dateTo: '',
  search: '',
};

const OPTIONS = { airlines: ['Arajet', 'American'], agents: ['Carlos'], supervisors: ['Juan'], positions: ['A5'], serviceTypes: ['GPU'] };

describe('ReviewFilters', () => {
  it('renders the general search and every facet filter', () => {
    render(<ReviewFilters filters={FILTERS} onFilterChange={() => {}} onResetFilters={() => {}} hasActiveFilters={false} options={OPTIONS} />);
    expect(screen.getByPlaceholderText(/vuelo, aerolínea, agente/i)).toBeInTheDocument();
    expect(screen.getByText('Aerolínea')).toBeInTheDocument();
    expect(screen.getByText('Agente')).toBeInTheDocument();
    expect(screen.getByText('Supervisor')).toBeInTheDocument();
    expect(screen.getByText('Posición / Stand')).toBeInTheDocument();
    expect(screen.getByText('Tipo de servicio')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ej. DM161')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ej. WO-1001')).toBeInTheDocument();
  });

  it('calls onFilterChange with the field name when a select changes', async () => {
    const onFilterChange = vi.fn();
    render(<ReviewFilters filters={FILTERS} onFilterChange={onFilterChange} onResetFilters={() => {}} hasActiveFilters={false} options={OPTIONS} />);
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'Arajet');
    expect(onFilterChange).toHaveBeenCalledWith('airline', 'Arajet');
  });

  it('disables Limpiar filtros when no filters are active and enables it otherwise', () => {
    const { rerender } = render(
      <ReviewFilters filters={FILTERS} onFilterChange={() => {}} onResetFilters={() => {}} hasActiveFilters={false} options={OPTIONS} />
    );
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeDisabled();

    rerender(<ReviewFilters filters={FILTERS} onFilterChange={() => {}} onResetFilters={() => {}} hasActiveFilters options={OPTIONS} />);
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).not.toBeDisabled();
  });
});
