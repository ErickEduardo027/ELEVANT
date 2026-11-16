import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationFilterBar from './NotificationFilterBar';

const BASE_FILTERS = {
  category: '',
  severity: '',
  status: '',
  datePreset: '',
  customRange: { from: '', to: '' },
  search: '',
};

describe('NotificationFilterBar', () => {
  it('renders category, severity and status options', () => {
    render(
      <NotificationFilterBar
        filters={BASE_FILTERS}
        onFilterChange={() => {}}
        onDatePreset={() => {}}
        onCustomDate={() => {}}
        onResetFilters={() => {}}
        hasActiveFilters={false}
      />
    );

    expect(screen.getByText('Operativas')).toBeInTheDocument();
    expect(screen.getByText('Crítica')).toBeInTheDocument();
    expect(screen.getByText('Solo no leídas')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Buscar por vuelo, referencia o descripción...')).toBeInTheDocument();
  });

  it('calls onFilterChange with the right key when a select changes', async () => {
    const onFilterChange = vi.fn();
    render(
      <NotificationFilterBar
        filters={BASE_FILTERS}
        onFilterChange={onFilterChange}
        onDatePreset={() => {}}
        onCustomDate={() => {}}
        onResetFilters={() => {}}
        hasActiveFilters={false}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'system');
    expect(onFilterChange).toHaveBeenCalledWith('category', 'system');
  });

  it('calls onDatePreset when a date preset pill is clicked', async () => {
    const onDatePreset = vi.fn();
    render(
      <NotificationFilterBar
        filters={BASE_FILTERS}
        onFilterChange={() => {}}
        onDatePreset={onDatePreset}
        onCustomDate={() => {}}
        onResetFilters={() => {}}
        hasActiveFilters={false}
      />
    );

    await userEvent.click(screen.getByText('Últimos 30 días'));
    expect(onDatePreset).toHaveBeenCalledWith('last30');
  });

  it('shows custom date inputs only when the custom preset is active', () => {
    const { rerender } = render(
      <NotificationFilterBar
        filters={BASE_FILTERS}
        onFilterChange={() => {}}
        onDatePreset={() => {}}
        onCustomDate={() => {}}
        onResetFilters={() => {}}
        hasActiveFilters={false}
      />
    );
    expect(screen.queryByText('Desde')).not.toBeInTheDocument();

    rerender(
      <NotificationFilterBar
        filters={{ ...BASE_FILTERS, datePreset: 'custom' }}
        onFilterChange={() => {}}
        onDatePreset={() => {}}
        onCustomDate={() => {}}
        onResetFilters={() => {}}
        hasActiveFilters
      />
    );
    expect(screen.getByText('Desde')).toBeInTheDocument();
  });

  it('disables "Limpiar filtros" when there are no active filters', () => {
    render(
      <NotificationFilterBar
        filters={BASE_FILTERS}
        onFilterChange={() => {}}
        onDatePreset={() => {}}
        onCustomDate={() => {}}
        onResetFilters={() => {}}
        hasActiveFilters={false}
      />
    );
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeDisabled();
  });
});