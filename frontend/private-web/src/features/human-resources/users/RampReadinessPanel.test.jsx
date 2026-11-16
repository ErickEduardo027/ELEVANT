import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RampReadinessPanel from './RampReadinessPanel';
import { listRampAgentReadiness } from '../../../services/humanResourcesShiftsReadService';

vi.mock('../../../services/humanResourcesShiftsReadService', () => ({ listRampAgentReadiness: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const ready = { rampProfileId: 'p-1', agentName: 'Ana Ramp', employeeNumber: 'E-1', ready: true, items: [
  { key: 'airport_id', status: 'Expiring', detail: 'Vence el 20/11/2026.', expiresOn: '2026-11-20' }] };
const blocked = { rampProfileId: 'p-2', agentName: 'Luis Ramp', employeeNumber: 'E-2', ready: false, items: [
  { key: 'mobile_account', status: 'Missing', detail: 'No tiene cuenta para la tablet.', expiresOn: null },
  { key: 'terminal_scope', status: 'Missing', detail: 'Sin terminal asignada.', expiresOn: null },
  { key: 'upcoming_shifts', status: 'Info', detail: 'Sin turnos en los próximos 14 días.', expiresOn: null }] };

it('summarizes who can operate and explains what each agent is missing', async () => {
  listRampAgentReadiness.mockResolvedValue([ready, blocked]);
  render(<RampReadinessPanel />);
  const panel = await screen.findByRole('region', { name: '¿Puede operar?' });
  expect(within(panel).getByText('1 de 2 agentes pueden operar.')).toBeInTheDocument();
  expect(within(panel).getByText('Le falta: Cuenta de la tablet, Terminal')).toBeInTheDocument();

  await userEvent.click(within(panel).getByRole('button', { name: /Luis Ramp/ }));
  const list = within(panel).getByRole('list', { name: 'Requisitos de Luis Ramp' });
  expect(list).toHaveTextContent('No tiene cuenta para la tablet.');
  expect(list).toHaveTextContent('Sin turnos en los próximos 14 días.');
});

it('stays hidden for accounts without access', async () => {
  listRampAgentReadiness.mockRejectedValue({ status: 403 });
  const { container } = render(<RampReadinessPanel />);
  await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
});
