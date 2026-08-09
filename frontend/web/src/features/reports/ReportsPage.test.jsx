import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportsPage from './ReportsPage';

describe('ReportsPage', () => {
  it('defaults to the closure report and shows today\'s flights with a registered position change', async () => {
    render(<ReportsPage />);
    expect(screen.getByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cierre operacional' })).toHaveAttribute('aria-selected', 'true');

    await waitFor(() => expect(screen.getByText('AA904')).toBeInTheDocument());
    expect(screen.getByText('DL2210')).toBeInTheDocument();
    // DM161 has no registered position change today, so it must not appear in the closure report.
    expect(screen.queryByText('DM161')).not.toBeInTheDocument();
  });

  it('switches to the operational summary and shows KPIs plus every chart', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('AA904')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: 'Resumen operativo' }));

    expect(await screen.findByText('Vuelos atendidos')).toBeInTheDocument();
    expect(screen.getByText('Vuelos atendidos por período')).toBeInTheDocument();
    expect(screen.getByText('Distribución de vuelos por estado')).toBeInTheDocument();
    expect(screen.getByText('Servicios ejecutados por tipo')).toBeInTheDocument();
    expect(screen.getByText('Carga operativa por agente')).toBeInTheDocument();
  });

  it('switches to ground time and reconciliation reports', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('AA904')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: 'Tiempo en tierra' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Vuelo, aerolínea, tipo de aeronave')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('tab', { name: 'Conciliación de servicios' }));
    await waitFor(() => expect(screen.getByPlaceholderText('Aerolínea, vuelo, servicio')).toBeInTheDocument());
  });

  it('narrows the closure report to a single airline via the filter bar', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getByText('AA904')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'Delta Air Lines');

    await waitFor(() => expect(screen.queryByText('AA904')).not.toBeInTheDocument());
    expect(screen.getByText('DL2210')).toBeInTheDocument();
  });

  it('shows the loading skeleton when forced', () => {
    render(<ReportsPage forceState="loading" />);
    expect(screen.getByTestId('report-skeleton')).toBeInTheDocument();
  });

  it('shows the empty state when forced', async () => {
    render(<ReportsPage forceState="reportsEmpty" />);
    await waitFor(() => expect(screen.getByText('No hay datos para el período seleccionado.')).toBeInTheDocument());
  });

  it('shows an error banner with a retry action when forced', async () => {
    render(<ReportsPage forceState="reportsError" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('No se pudo cargar el reporte solicitado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('shows the period label derived from the active date range in the header', () => {
    render(<ReportsPage />);
    expect(within(screen.getByRole('heading', { name: 'Reportes' }).closest('div')).getByText(/\d{2} [A-Z]{3} \d{4}/)).toBeInTheDocument();
  });
});
