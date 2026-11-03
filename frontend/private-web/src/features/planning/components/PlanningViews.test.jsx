import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlanningTable, PlanningCalendar, planningInstant, shiftPlanningDay } from './PlanningViews';

function scale(index = 0, overrides = {}) {
  return { id: `scale-${index}`, operationCode: `OP-${String(index).padStart(3, '0')}`,
    timelineTime: '2026-10-29T12:00:00Z', status: 'scheduled', airlineName: 'QA airline',
    station: { ianaTimeZone: 'America/Santo_Domingo' }, assignedAgents: [],
    arrival: { flightNumber: `QA${index}A`, origin: { iataCode: 'MIA' }, destination: { iataCode: 'SDQ' }, scheduledAt: '2026-10-29T12:00:00Z' },
    departure: { flightNumber: `QA${index}D`, origin: { iataCode: 'SDQ' }, destination: { iataCode: 'MIA' }, scheduledAt: '2026-10-29T14:00:00Z' }, ...overrides };
}

describe('canonical planning views', () => {
  it('pages 25 scales, retains both legs and opens the existing scale ID', () => {
    const select = vi.fn();
    const flights = Array.from({ length: 26 }, (_, index) => scale(index));
    const { rerender } = render(<PlanningTable flights={flights} onSelectFlight={select} scopeKey="day-a" />);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('QA0A')).toBeVisible();
    expect(screen.getByText('QA0D')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir detalle de OP-000' }));
    expect(select).toHaveBeenCalledWith('scale-0');
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('QA25A')).toBeVisible();
    expect(screen.queryByText('QA0A')).not.toBeInTheDocument();
    rerender(<PlanningTable flights={flights} onSelectFlight={select} scopeKey="day-b" />);
    expect(screen.getByText('QA0A')).toBeVisible();
  });

  it('sorts the canonical records without changing their identity', () => {
    const select = vi.fn();
    render(<PlanningTable flights={[scale(2), scale(1)]} onSelectFlight={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por Escala' }));
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('OP-001');
    fireEvent.click(within(rows[1]).getByRole('button'));
    expect(select).toHaveBeenCalledWith('scale-1');
  });

  it('renders arrival and departure as events of the same scale and navigates dates', () => {
    const select = vi.fn(); const changeDate = vi.fn();
    render(<PlanningCalendar flights={[scale()]} selectedDate="2026-10-29" onSelectFlight={select} onDateChange={changeDate} />);
    const events = screen.getAllByRole('button', { name: 'Abrir detalle de OP-000' });
    expect(events).toHaveLength(2);
    events.forEach(event => fireEvent.click(event));
    expect(select.mock.calls).toEqual([['scale-0'], ['scale-0']]);
    fireEvent.click(screen.getByRole('button', { name: 'Día anterior' }));
    expect(changeDate).toHaveBeenLastCalledWith('2026-10-28');
    fireEvent.click(screen.getByRole('button', { name: 'Día siguiente' }));
    expect(changeDate).toHaveBeenLastCalledWith('2026-10-30');
  });

  it('keeps out-of-day and missing-time legs visible without invented durations', () => {
    const flight = scale(0, { arrival: { ...scale().arrival, scheduledAt: '2026-10-29T02:00:00Z' }, departure: { ...scale().departure, scheduledAt: null } });
    render(<PlanningCalendar flights={[flight]} selectedDate="2026-10-29" onSelectFlight={vi.fn()} />);
    expect(screen.getByText('Fuera del día seleccionado')).toBeVisible();
    expect(screen.getByText('Sin tramo horario')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Abrir detalle de OP-000' })).toHaveLength(2);
    expect(screen.queryByText(/Ventana operativa/)).not.toBeInTheDocument();
  });

  it('uses station midnight and DST offsets and shifts calendar days independently of DST', () => {
    expect(planningInstant('2026-10-29T02:00:00Z', 'America/Santo_Domingo')).toMatchObject({ date: '2026-10-28', clock: '22:00' });
    const early = planningInstant('2026-11-01T05:30:00Z', 'America/New_York');
    const late = planningInstant('2026-11-01T06:30:00Z', 'America/New_York');
    expect(early.clock).toBe(late.clock);
    expect(early.offset).not.toBe(late.offset);
    expect(shiftPlanningDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(planningInstant(null)).toBeNull();
  });
});
