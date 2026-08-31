import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportFilterBar from './ReportFilterBar';

const OPTIONS = { airlines: ['Arajet', 'American Airlines'], agents: ['Carlos Medina'], terminals: ['Terminal A'], positions: ['A5'] };

function renderBar(overrides = {}) {
  const props = {
    activeReport: 'closure',
    datePreset: 'today',
    customRange: { from: '', to: '' },
    onSelectPreset: () => {},
    onCustomDateChange: () => {},
    facets: { airline: '', agent: '', terminal: '', position: '' },
    onFacetChange: () => {},
    options: OPTIONS,
    hasActiveFilters: false,
    onResetFilters: () => {},
    ...overrides,
  };
  return render(<ReportFilterBar {...props} />);
}

describe('ReportFilterBar', () => {
  it('shows Aerolínea, Agente and Terminal for every report', () => {
    renderBar();
    expect(screen.getByText('Aerolínea')).toBeInTheDocument();
    expect(screen.getByText('Agente')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('only shows the Posición filter for the closure report', () => {
    const { rerender } = renderBar({ activeReport: 'closure' });
    expect(screen.getByText('Posición')).toBeInTheDocument();

    rerender(
      <ReportFilterBar
        activeReport="groundTime"
        datePreset="today"
        customRange={{ from: '', to: '' }}
        onSelectPreset={() => {}}
        onCustomDateChange={() => {}}
        facets={{ airline: '', agent: '', terminal: '', position: '' }}
        onFacetChange={() => {}}
        options={OPTIONS}
        hasActiveFilters={false}
        onResetFilters={() => {}}
      />
    );
    expect(screen.queryByText('Posición')).not.toBeInTheDocument();
  });

  it('calls onFacetChange with the field name when a select changes', async () => {
    const onFacetChange = vi.fn();
    renderBar({ onFacetChange });
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'Arajet');
    expect(onFacetChange).toHaveBeenCalledWith('airline', 'Arajet');
  });

  it('disables Limpiar filtros when no filters are active', () => {
    renderBar({ hasActiveFilters: false });
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).toBeDisabled();
  });

  it('shows active filter chips once filters are applied', () => {
    renderBar({
      datePreset: 'week',
      facets: { airline: 'Arajet', agent: '', terminal: '', position: '' },
      hasActiveFilters: true,
    });
    const chips = within(screen.getByTestId('active-filter-chips'));
    expect(chips.getByText('Esta semana')).toBeInTheDocument();
    expect(chips.getByText('Aerolínea: Arajet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpiar filtros' })).not.toBeDisabled();
  });
});
