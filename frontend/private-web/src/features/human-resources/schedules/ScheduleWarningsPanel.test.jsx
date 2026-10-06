import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScheduleWarningsPanel from './ScheduleWarningsPanel';
import { getHumanResourcesScheduleWarnings } from '../../../services/humanResourcesScheduleWarningsService';

vi.mock('../../../services/humanResourcesScheduleWarningsService', () => ({
  getHumanResourcesScheduleWarnings: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: {
  token: 'account-one',
  stationScopes: [
    { stationId: '20000000-0000-7000-8000-000000000003', stationCode: 'PUJ' },
    { stationId: '20000000-0000-7000-8000-000000000099', stationCode: 'SDQ' },
  ],
} }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => auth }));

const stationId = '20000000-0000-7000-8000-000000000003';
const otherStationId = '20000000-0000-7000-8000-000000000099';
const shiftId = '50000000-0000-7000-8000-000000000005';
const from = '2026-08-17';
const to = '2026-08-23';
const basePage = { stationId, from, to, page: 1, limit: 20, hasMore: false,
  asOf: '2026-08-18T12:00:00Z', ruleVersion: 'dev-2026-10-05',
  ruleEffectiveOn: '2026-10-05', warnings: [] };
const warning = {
  anchorShiftId: shiftId, rampProfileId: '50000000-0000-7000-8000-000000000001',
  agentName: 'Riley Ramp', employeeNumber: 'DEV-RA-001', workDate: '2026-08-18',
  kind: 'ShortRest', evidence: [{ shiftId, stationId, stationCode: 'PUJ',
    startsAt: '2026-08-18T10:00:00Z', endsAt: '2026-08-18T18:00:00Z' }],
  hasRestrictedEvidence: false, measuredMinutes: 659, thresholdMinutes: 720,
  ruleVersion: 'dev-2026-10-05', ruleEffectiveOn: '2026-10-05', reason: null,
};

beforeEach(() => {
  auth.session = { token: 'account-one', stationScopes: [
    { stationId, stationCode: 'PUJ' }, { stationId: otherStationId, stationCode: 'SDQ' },
  ] };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows an honest empty authorized page and preliminary rule, not a compliance verdict', async () => {
  getHumanResourcesScheduleWarnings.mockResolvedValue(basePage);
  render(<ScheduleWarningsPanel from={from} to={to} revision={0} visibleShiftIds={[]} />);
  expect(await screen.findByText(/No hay alertas de programación/)).toBeInTheDocument();
  expect(screen.getByText(/orientación preliminar/i)).toBeInTheDocument();
  expect(screen.queryByText(/cumple la ley|horas extra pagadas/i)).not.toBeInTheDocument();
  expect(getHumanResourcesScheduleWarnings).toHaveBeenCalledWith(
    { stationId, from, to, page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('renders unevaluable and restricted evidence without inventing a measured result or foreign station', async () => {
  getHumanResourcesScheduleWarnings.mockResolvedValue({ ...basePage, warnings: [
    { ...warning, kind: 'Unevaluable', measuredMinutes: null, thresholdMinutes: null,
      reason: 'AmbiguousLocalTime', evidence: [], hasRestrictedEvidence: false },
    { ...warning, anchorShiftId: '50000000-0000-7000-8000-000000000006',
      hasRestrictedEvidence: true, evidence: [], measuredMinutes: null },
  ] });
  render(<ScheduleWarningsPanel from={from} to={to} revision={0} visibleShiftIds={[]} />);
  expect(await screen.findByText(/No evaluable/)).toBeInTheDocument();
  expect(screen.getByText(/Hora local ambigua/)).toBeInTheDocument();
  expect(screen.getByText(/Evidencia restringida/)).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Resultados de alertas' }))
    .queryByText(/SDQ|659 minutos/)).not.toBeInTheDocument();
});

it('shows a short-rest measure and links only a visible roster shift', async () => {
  getHumanResourcesScheduleWarnings.mockResolvedValue({ ...basePage, warnings: [warning] });
  render(<ScheduleWarningsPanel from={from} to={to} revision={0}
    visibleShiftIds={[shiftId]} />);
  expect(await screen.findByText(/659 minutos/)).toBeInTheDocument();
  expect(screen.getByText(/Descanso corto/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Ver turno/ })).toHaveAttribute('href', `#turno-${shiftId}`);
});

it('clears former station data on switch and refuses a late response', async () => {
  let resolveOld;
  getHumanResourcesScheduleWarnings.mockImplementation(query => query.stationId === stationId
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ ...basePage, stationId: otherStationId, warnings: [] }));
  render(<ScheduleWarningsPanel from={from} to={to} revision={0} visibleShiftIds={[]} />);
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  await userEvent.selectOptions(screen.getByLabelText('Estación de alertas'), otherStationId);
  expect(await screen.findByText(/No hay alertas de programación/)).toBeInTheDocument();
  await act(async () => resolveOld({ ...basePage, warnings: [warning] }));
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

it('clears former account data when its pending request resolves after a session switch', async () => {
  let resolveOld;
  getHumanResourcesScheduleWarnings.mockImplementationOnce(() =>
    new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ ...basePage, warnings: [] });
  const view = render(<ScheduleWarningsPanel from={from} to={to} revision={0} visibleShiftIds={[]} />);
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  auth.session = { ...auth.session, token: 'account-two' };
  view.rerender(<ScheduleWarningsPanel from={from} to={to} revision={0} visibleShiftIds={[]} />);
  expect(await screen.findByText(/No hay alertas de programación/)).toBeInTheDocument();
  await act(async () => resolveOld({ ...basePage, warnings: [warning] }));
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

it('removes previous rows on 403 and 404, and refreshes on revision, focus and online', async () => {
  getHumanResourcesScheduleWarnings.mockResolvedValueOnce({ ...basePage, warnings: [warning] })
    .mockRejectedValueOnce({ status: 403 })
    .mockRejectedValueOnce({ status: 404 })
    .mockResolvedValue(basePage);
  const view = render(<ScheduleWarningsPanel from={from} to={to} revision={0}
    visibleShiftIds={[]} />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  view.rerender(<ScheduleWarningsPanel from={from} to={to} revision={1} visibleShiftIds={[]} />);
  expect(await screen.findByText(/No tienes acceso a estas alertas/)).toBeInTheDocument();
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText(/Estación no disponible/)).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(await screen.findByText(/No hay alertas de programación/)).toBeInTheDocument();
  expect(getHumanResourcesScheduleWarnings).toHaveBeenCalledTimes(4);
});

it('does not query a station removed from the session grant', async () => {
  getHumanResourcesScheduleWarnings.mockResolvedValue({ ...basePage, warnings: [warning] });
  const view = render(<ScheduleWarningsPanel from={from} to={to} revision={0}
    visibleShiftIds={[]} />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  auth.session = { ...auth.session, stationScopes: [] };
  view.rerender(<ScheduleWarningsPanel from={from} to={to} revision={0}
    visibleShiftIds={[]} />);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(screen.getByText(/No hay estaciones autorizadas/)).toBeInTheDocument();
  expect(getHumanResourcesScheduleWarnings).toHaveBeenCalledTimes(1);
});

it('caps a 31-day roster default and lets GH consult the remaining day explicitly', async () => {
  getHumanResourcesScheduleWarnings.mockImplementation(async query => ({
    ...basePage, ...query, hasMore: false, warnings: [],
  }));
  render(<ScheduleWarningsPanel from="2026-08-01" to="2026-08-31" revision={0}
    visibleShiftIds={[]} />);
  await waitFor(() => expect(getHumanResourcesScheduleWarnings).toHaveBeenCalledWith(
    { stationId, from: '2026-08-01', to: '2026-08-30', page: 1, limit: 20 },
    expect.anything()));
  expect(screen.getByText(/día restante del mes/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-08-31' } });
  expect(screen.getByText(/intervalo válido/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-08-31' } });
  await waitFor(() => expect(getHumanResourcesScheduleWarnings).toHaveBeenCalledWith(
    { stationId, from: '2026-08-31', to: '2026-08-31', page: 1, limit: 20 },
    expect.anything()));
});
