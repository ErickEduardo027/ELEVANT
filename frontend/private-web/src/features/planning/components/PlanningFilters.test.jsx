import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningFilters from './PlanningFilters';
import { STATION_ID, STATION_SCOPES } from '../testing/planningFixtures';

const FILTERS = {
  airlineIata: '',
  status: '',
  aircraftType: '',
  position: '',
  terminal: '',
  agent: '',
  search: '',
};

const OPTIONS = {
  airlines: ['AA', 'ZZ'],
  statuses: ['Delayed', 'Confirmed'],
  aircraftTypes: ['A320', 'B787'],
  positions: ['A02', 'B21'],
  terminals: ['A', 'B'],
  agents: ['Riley Ramp'],
};

function renderFilters(overrides = {}) {
  const props = {
    filters: FILTERS,
    onFilterChange: vi.fn(),
    quickFilter: 'none',
    onQuickFilter: vi.fn(),
    onReset: vi.fn(),
    options: OPTIONS,
    stationScopes: STATION_SCOPES,
    selectedStationId: STATION_ID,
    selectedDate: '2026-08-19',
    onDateChange: vi.fn(),
    ...overrides,
  };

  render(<PlanningFilters {...props} />);
  return props;
}

describe('PlanningFilters', () => {
  it('shows PUJ as fixed context and changes only the operational date scope', () => {
    const props = renderFilters();

    expect(screen.getByRole('group', { name: 'Estación' })).toHaveTextContent('PUJ');
    expect(screen.queryByRole('combobox', { name: 'Estación' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Fecha operativa')).toHaveValue('2026-08-19');
    fireEvent.change(screen.getByLabelText('Fecha operativa'), { target: { value: '2026-08-20' } });

    expect(props.onDateChange).toHaveBeenLastCalledWith('2026-08-20');
    expect(screen.getByText('La API aplica sus permisos de estación a cada consulta.')).toBeInTheDocument();
  });

  it('keeps scope controls available while loading so a slow request can be superseded', () => {
    renderFilters({ loading: true });

    expect(screen.getByRole('group', { name: 'Estación' })).toHaveTextContent('PUJ');
    expect(screen.getByLabelText('Fecha operativa')).toBeEnabled();
  });

  it('emits canonical filter values for selects and search', async () => {
    const props = renderFilters();

    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'AA');
    await userEvent.selectOptions(screen.getByLabelText('Terminal'), 'B');
    await userEvent.type(screen.getByLabelText('Búsqueda'), 'ZZ');

    expect(props.onFilterChange).toHaveBeenCalledWith('airlineIata', 'AA');
    expect(props.onFilterChange).toHaveBeenCalledWith('terminal', 'B');
    expect(props.onFilterChange).toHaveBeenCalledWith('search', 'Z');
  });

  it('offers only delayed and pending-resource quick filters', async () => {
    const props = renderFilters();
    const delayed = screen.getByRole('button', { name: 'Con retraso' });
    const pending = screen.getByRole('button', { name: 'Pendientes de recursos' });

    expect(delayed).toBeInTheDocument();
    expect(pending).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hoy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mañana' })).not.toBeInTheDocument();
    await userEvent.click(delayed);
    expect(props.onQuickFilter).toHaveBeenCalledWith('delayed');
  });

  it('marks the active quick filter and can reset all filters', async () => {
    const props = renderFilters({ quickFilter: 'unassigned' });

    expect(screen.getByRole('button', { name: 'Pendientes de recursos' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('uses the shared status vocabulary', () => {
    renderFilters();

    const statusSelect = screen.getByLabelText('Estado');
    expect(within(statusSelect).getByText('Retrasada')).toBeInTheDocument();
    expect(within(statusSelect).getByText('Confirmada')).toBeInTheDocument();
  });
});