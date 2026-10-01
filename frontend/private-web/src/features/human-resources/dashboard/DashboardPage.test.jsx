import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { getHumanResourcesDashboardSnapshot } from '../../../services/humanResourcesDashboardService';

const observerFactory = vi.hoisted(() => vi.fn());

vi.mock('../../../services/humanResourcesDashboardService', () => ({
  getHumanResourcesDashboardSnapshot: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

beforeEach(() => {
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
  vi.mocked(getHumanResourcesDashboardSnapshot).mockReset();
  vi.mocked(getHumanResourcesDashboardSnapshot).mockResolvedValue({
    activeStaffTotal: 2,
    pendingAccounts: [{ id: 'agent-2', name: 'Luis Vega', role: 'Rampa' }],
  });
});

it('refreshes linked-account facts after a durable ramp-profile change', async () => {
  let current = { activeStaffTotal: 2,
    pendingAccounts: [{ id: 'agent-2', name: 'Luis Vega', role: 'Rampa' }] };
  vi.mocked(getHumanResourcesDashboardSnapshot).mockImplementation(async () => current);
  render(<MemoryRouter><DashboardPage dashboardReadOnlyDemo /></MemoryRouter>);
  expect(await screen.findByText('Luis Vega')).toBeInTheDocument();
  await waitFor(() => expect(observerFactory).toHaveBeenCalledOnce());

  current = { activeStaffTotal: 2,
    pendingAccounts: [{ id: 'agent-4', name: 'Ana Rivas', role: 'Rampa' }] };
  await act(async () => observerFactory.mock.calls[0][0](['ramp_profiles']));
  expect(await screen.findByText('Ana Rivas')).toBeInTheDocument();
  expect(screen.queryByText('Luis Vega')).not.toBeInTheDocument();
});

it('revalidates the authorized summary when the tab regains focus', async () => {
  let current = { activeStaffTotal: 1,
    pendingAccounts: [{ id: 'agent-2', name: 'Luis Vega', role: 'Rampa' }] };
  vi.mocked(getHumanResourcesDashboardSnapshot).mockImplementation(async () => current);
  render(<MemoryRouter><DashboardPage dashboardReadOnlyDemo /></MemoryRouter>);
  expect(await screen.findByText('Luis Vega')).toBeInTheDocument();

  current = { activeStaffTotal: 1, pendingAccounts: [] };
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('Todos los perfiles activos tienen cuenta vinculada')).toBeInTheDocument();
  expect(screen.queryByText('Luis Vega')).not.toBeInTheDocument();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses a polling fallback when no change hint arrives', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let current = { activeStaffTotal: 1,
    pendingAccounts: [{ id: 'agent-2', name: 'Luis Vega', role: 'Rampa' }] };
  vi.mocked(getHumanResourcesDashboardSnapshot).mockImplementation(async () => current);
  render(<MemoryRouter><DashboardPage dashboardReadOnlyDemo /></MemoryRouter>);
  expect(await screen.findByText('Luis Vega')).toBeInTheDocument();

  current = { activeStaffTotal: 1, pendingAccounts: [] };
  await act(async () => vi.advanceTimersByTimeAsync(25_000));
  expect(await screen.findByText('Todos los perfiles activos tienen cuenta vinculada')).toBeInTheDocument();
});

it('shows only authorized personnel facts, without fixture indicators or demo claims', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  render(<MemoryRouter><DashboardPage dashboardReadOnlyDemo /></MemoryRouter>);

  expect(await screen.findByText('Luis Vega')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText('2').length).toBeGreaterThan(0));
  expect(screen.getByText('Agentes de rampa activos')).toBeInTheDocument();
  expect(screen.queryByText('Datos sintéticos · Solo lectura')).not.toBeInTheDocument();
  expect(screen.queryByText('148')).not.toBeInTheDocument();
  expect(screen.queryByText('Habilitaciones próximas a vencer')).not.toBeInTheDocument();
  expect(screen.queryByText('Disponibilidad actual')).not.toBeInTheDocument();
  expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
});

it('offers a retry when the authorized read fails', async () => {
  vi.mocked(getHumanResourcesDashboardSnapshot).mockRejectedValueOnce(new Error('No hay conexión'));
  render(<MemoryRouter><DashboardPage dashboardReadOnlyDemo /></MemoryRouter>);

  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible cargar el resumen.');
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});
