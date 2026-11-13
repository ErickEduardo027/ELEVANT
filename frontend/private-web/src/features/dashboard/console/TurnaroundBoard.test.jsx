import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import TurnaroundBoard from './TurnaroundBoard';
import { classifyTurnarounds } from '../dashboardModel';
import { dashboardMessages } from '../dashboardMessages';
import { createTranslator } from '../../../i18n/languageStore';

const t = createTranslator(dashboardMessages, 'es');
const turnaround = (id, operationCode, extra = {}) => ({ id, operationCode, status: 'Confirmed',
  airline: { name: 'Demo Airlines' }, arrival: { flightNumber: 'ZZ9001', scheduledAt: '2026-11-12T14:08:00Z' },
  departure: { flightNumber: 'ZZ9002' }, stand: null, agents: [], services: [], ...extra });

afterEach(cleanup);

it('labels a demo turnaround «Demo» next to its code, and no other row (ADR-0041)', () => {
  render(<TurnaroundBoard t={t} language="es" locale="es-DO" timeZone="America/Santo_Domingo"
    groups={classifyTurnarounds([turnaround('t-demo', 'PUJ-20261112-003', { isDemo: true }),
      turnaround('t-real', 'PUJ-20261112-004', { arrival: { flightNumber: 'ZZ161', scheduledAt: '2026-11-12T15:00:00Z' } })])} />);

  const [demo, real] = screen.getAllByRole('row').slice(1);
  expect(within(demo).getByRole('link', { name: 'PUJ-20261112-003' })).toBeInTheDocument();
  expect(within(demo).getByText('Demo')).toBeInTheDocument();
  expect(within(real).getByRole('link', { name: 'PUJ-20261112-004' })).toBeInTheDocument();
  expect(within(real).queryByText('Demo')).not.toBeInTheDocument();
});
