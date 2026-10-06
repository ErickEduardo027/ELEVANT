import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateRangePicker from './DateRangePicker';

describe('DateRangePicker', () => {
  it('renders every quick preset and marks the active one', () => {
    render(
      <DateRangePicker
        datePreset="today"
        onSelectPreset={() => {}}
        customRange={{ from: '', to: '' }}
        onCustomDateChange={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ayer' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Esta semana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Este mes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rango personalizado' })).toBeInTheDocument();
  });

  it('calls onSelectPreset with the preset id when clicked', async () => {
    const onSelectPreset = vi.fn();
    render(
      <DateRangePicker
        datePreset="today"
        onSelectPreset={onSelectPreset}
        customRange={{ from: '', to: '' }}
        onCustomDateChange={() => {}}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Esta semana' }));
    expect(onSelectPreset).toHaveBeenCalledWith('week');
  });

  it('calls onCustomDateChange with the field and value for the date inputs', async () => {
    const onCustomDateChange = vi.fn();
    render(
      <DateRangePicker
        datePreset="custom"
        onSelectPreset={() => {}}
        customRange={{ from: '', to: '' }}
        onCustomDateChange={onCustomDateChange}
      />
    );
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-08-01' } });
    expect(onCustomDateChange).toHaveBeenCalledWith('from', '2026-08-01');
  });
});