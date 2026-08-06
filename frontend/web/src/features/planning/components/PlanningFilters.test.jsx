import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningFilters from './PlanningFilters';

const FILTERS = {
  date: '',
  airportCode: '',
  airlineIata: '',
  status: '',
  aircraftType: '',
  position: '',
  supervisor: '',
  agent: '',
  search: '',
};

const OPTIONS = {
  dates: ['2026-08-05'],
  airports: ['PUJ'],
  airlines: ['AA', 'DM'],
  statuses: ['delayed', 'scheduled'],
  aircraftTypes: ['A320', 'B787'],
  positions: ['A5', 'B21'],
  supervisors: ['J. Ramírez'],
  agents: ['M. Castillo'],
};

describe('PlanningFilters', () => {
  it('calls onFilterChange with the new value when the airline select changes', async () => {
    const onFilterChange = vi.fn();
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={onFilterChange} quickFilter="none" onQuickFilter={() => {}} options={OPTIONS} />
    );
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'AA');
    expect(onFilterChange).toHaveBeenCalledWith('airlineIata', 'AA');
  });

  it('calls onFilterChange with the search text as the user types', async () => {
    const onFilterChange = vi.fn();
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={onFilterChange} quickFilter="none" onQuickFilter={() => {}} options={OPTIONS} />
    );
    await userEvent.type(screen.getByLabelText('Búsqueda'), 'DM');
    expect(onFilterChange).toHaveBeenCalledWith('search', 'D');
    expect(onFilterChange).toHaveBeenCalledWith('search', 'M');
  });

  it('renders the five quick-filter chips and calls onQuickFilter when clicked', async () => {
    const onQuickFilter = vi.fn();
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={() => {}} quickFilter="none" onQuickFilter={onQuickFilter} options={OPTIONS} />
    );
    for (const label of ['Hoy', 'Mañana', 'Retrasados', 'Sin asignación', 'Pendientes']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Retrasados' }));
    expect(onQuickFilter).toHaveBeenCalledWith('delayed');
  });

  it('marks the active quick filter with aria-pressed', () => {
    render(
      <PlanningFilters filters={FILTERS} onFilterChange={() => {}} quickFilter="delayed" onQuickFilter={() => {}} options={OPTIONS} />
    );
    expect(screen.getByRole('button', { name: 'Retrasados' })).toHaveAttribute('aria-pressed', 'true');
  });
});
