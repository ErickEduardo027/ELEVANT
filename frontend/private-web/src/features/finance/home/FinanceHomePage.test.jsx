import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import FinanceHomePage from './FinanceHomePage';

const stationId = '10000000-0000-7000-8000-000000000001';
const stations = [{ stationId, stationCode: 'PUJ' }];
const data = {
  kpis: { approvedServices: 1, readyForPreinvoice: 1,
    draftPreinvoices: 1, disputedPreinvoices: 0 },
  bounds: { servicesHaveMore: false, preinvoicesHaveMore: false },
  approvedServices: [{ id: 'service-1', airline: 'Arajet', flight: 'DM 100',
    service: 'GPU', operationDate: '2026-09-27', amount: 250, currency: 'USD' }],
  pendingActions: [{ id: 'pre-1', kind: 'Pre-factura', airline: 'Arajet',
    detail: 'Preparar envío a la aerolínea', moduleId: 'finance-preinvoices' }],
};

function page(props = {}) {
  return <FinanceHomePage status="success" data={data} stations={stations}
    stationId={stationId} onStationChange={() => {}} onNavigate={() => {}}
    {...props} />;
}

it('shows station-authorized facts without synthetic or unimplemented indicators', () => {
  render(page());
  expect(screen.getByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
  expect(screen.getByText('DM 100')).toBeInTheDocument();
  expect(screen.getByText('US$250.00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Arajet/i })).toHaveTextContent('Preparar envío a la aerolínea');
  expect(screen.queryByText(/Datos sintéticos/i)).not.toBeInTheDocument();
  expect(screen.queryByText('Diferencias por conciliar')).not.toBeInTheDocument();
  expect(screen.queryByText('36')).not.toBeInTheDocument();
});

it('selects another granted station and navigates to real preinvoices', () => {
  const onStationChange = vi.fn();
  const onNavigate = vi.fn();
  render(page({ stations: [...stations, { stationId: 'station-two', stationCode: 'SDQ' }],
    onStationChange, onNavigate }));
  fireEvent.change(screen.getByLabelText('Estación financiera'), {
    target: { value: 'station-two' },
  });
  expect(onStationChange).toHaveBeenCalledWith('station-two');
  fireEvent.click(screen.getByRole('button', { name: /Arajet/i }));
  expect(onNavigate).toHaveBeenCalledWith('finance-preinvoices');
});

it('discloses bounded result counts and handles missing prices honestly', () => {
  render(page({ data: { ...data,
    bounds: { servicesHaveMore: true, preinvoicesHaveMore: true },
    approvedServices: [{ ...data.approvedServices[0], amount: null, currency: null }],
  } }));
  expect(screen.getByText(/muestra hasta 200 servicios/i)).toBeInTheDocument();
  expect(screen.getByText(/muestra hasta 50 prefacturas/i)).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
});

it('offers retry on connection errors and no invented values without access', () => {
  const onRetry = vi.fn();
  const { rerender } = render(page({ status: 'error', data: null, onRetry }));
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(onRetry).toHaveBeenCalledOnce();
  rerender(page({ status: 'forbidden', data: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('No hay una estación financiera autorizada');
  expect(screen.queryByText('36')).not.toBeInTheDocument();
});