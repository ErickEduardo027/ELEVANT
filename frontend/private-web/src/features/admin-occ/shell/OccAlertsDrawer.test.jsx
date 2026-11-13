import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { alertSummary } from '../../dashboard/noc/alertModel';
import OccAlertsDrawer from './OccAlertsDrawer';
import OccAlertsButton from './status/OccAlertsButton';
import { createOccShellValue, OccShellTestProvider } from './testing/occShellFixtures';

// Synthetic notices in the shape of OperationalNotificationResponse, with invented ids.
let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  return { id: `95000000-0000-4000-8000-${suffix}`, operationId: `75000000-0000-4000-8000-${suffix}`,
    operationCode: `OP-${600 + sequence}`, stationCode: 'PUJ', kind, sourceId: `85000000-0000-4000-8000-${suffix}`,
    occurredAt: '2026-11-12T18:28:00Z', readAt: null, ...overrides };
}

const DAY = () => [
  notice('incident_reported', { operationCode: 'OP-0412' }),
  notice('flight_cancelled_by_provider', { operationCode: 'OP-0413' }),
  notice('contract_not_in_force', { operationCode: 'OP-0414', readAt: '2026-11-12T18:32:00Z' }),
  notice('operation_submitted', { operationCode: 'OP-0415' }),
];

// The status bar's alerts and the drawer they open, as OccTopbar wires them (without the bar around them).
function AlertsHarness({ shell }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  return (
    <LanguageScope>
      <OccShellTestProvider value={shell}>
        <OccAlertsButton ref={button} summary={alertSummary(shell.notices.items)} status={shell.notices.status}
          onOpen={() => setOpen(true)} expanded={open} />
        <button type="button">Otra cosa</button>
        {open ? <OccAlertsDrawer id="occ-alerts" onClose={() => setOpen(false)} returnFocusRef={button} /> : null}
      </OccShellTestProvider>
    </LanguageScope>
  );
}

function renderHarness(notices = {}) {
  const items = DAY();
  const markRead = vi.fn(async id => ({ id }));
  const shell = createOccShellValue({ notices: { status: 'success', items, markRead, ...notices } });
  render(<AlertsHarness shell={shell} />);
  return { items, markRead };
}

async function openDrawer(user) {
  await user.click(screen.getByRole('button', { name: /^\d+ alertas?$|^Sin alertas$|^Alertas$/ }));
  return screen.getByRole('dialog', { name: 'Alertas y avisos' });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
});

afterEach(() => {
  cleanup();
  resetLanguageForTests();
  window.history.replaceState({}, '', '/');
});

describe('OccAlertsDrawer', () => {
  it('is titled Alertas y avisos with the sections Alertas and Avisos recientes and the history link', async () => {
    const user = userEvent.setup();
    renderHarness();
    const drawer = await openDrawer(user);
    expect(drawer).toHaveAttribute('aria-modal', 'true');

    const alerts = within(drawer).getByRole('region', { name: 'Alertas' });
    expect(within(alerts).getByText('2 sin recibir')).toBeInTheDocument();
    expect(within(alerts).getAllByRole('button', { name: 'Recibido' })).toHaveLength(2);
    // Times are the station's: 18:32 UTC is 14:32 in Punta Cana.
    expect(within(alerts).getByText('Recibida a las 14:32')).toBeInTheDocument();
    const recent = within(drawer).getByRole('region', { name: 'Avisos recientes' });
    expect(recent).toHaveTextContent('Operación entregada para revisión');
    expect(within(recent).queryByRole('button', { name: 'Recibido' })).not.toBeInTheDocument();
    // The sections follow each other in that order, and the history link comes last.
    expect(alerts.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const history = within(drawer).getByRole('link', { name: 'Ver historial de avisos' });
    expect(history).toHaveAttribute('href', '/admin-occ/notifications');
    expect(recent.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Recibido is the read receipt of the account, through the shell', async () => {
    const user = userEvent.setup();
    const { items, markRead } = renderHarness();
    const drawer = await openDrawer(user);
    const incident = within(drawer).getByText('OP-0412').closest('li');
    await user.click(within(incident).getByRole('button', { name: 'Recibido' }));
    // notices.markRead is PUT notifications/{id}/read (OccShellProvider.test.jsx follows it to the service).
    expect(markRead).toHaveBeenCalledExactlyOnceWith(items[0].id);
  });

  it('Abrir navigates to the notice target and closes the drawer', async () => {
    const user = userEvent.setup();
    const { items } = renderHarness();
    let drawer = await openDrawer(user);
    const incident = within(drawer).getByText('OP-0412').closest('li');
    await user.click(within(incident).getByRole('button', { name: 'Abrir' }));
    expect(`${window.location.pathname}${window.location.search}`)
      .toBe(`/admin-occ/review?operationId=${items[0].operationId}`);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // A flight the provider cancelled opens the planning board.
    drawer = await openDrawer(user);
    const cancelled = within(drawer).getByText('OP-0413').closest('li');
    await user.click(within(cancelled).getByRole('button', { name: 'Abrir' }));
    expect(window.location.pathname).toBe('/admin-occ/planning');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('the history link closes the drawer', async () => {
    const user = userEvent.setup();
    renderHarness();
    const drawer = await openDrawer(user);
    const history = within(drawer).getByRole('link', { name: 'Ver historial de avisos' });
    // The link itself is next/link's; jsdom does not navigate, so only the closing is checked here.
    history.addEventListener('click', event => event.preventDefault(), { once: true });
    fireEvent.click(history);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Esc closes the drawer with defaultPrevented true', async () => {
    const user = userEvent.setup();
    renderHarness();
    await openDrawer(user);
    const focused = document.activeElement;
    expect(screen.getByRole('dialog').contains(focused)).toBe(true);
    const escape = createEvent.keyDown(focused, { key: 'Escape' });
    act(() => { fireEvent(focused, escape); });
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Tab stays inside the drawer', async () => {
    const user = userEvent.setup();
    renderHarness();
    const drawer = await openDrawer(user);
    // Focus starts on «Cerrar», the drawer's first control.
    expect(within(drawer).getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    // Backwards from the first control lands on the last one, the history link, and forwards wraps around again.
    await user.tab({ shift: true });
    expect(within(drawer).getByRole('link', { name: 'Ver historial de avisos' })).toHaveFocus();
    await user.tab();
    expect(within(drawer).getByRole('button', { name: 'Cerrar' })).toHaveFocus();
    const stops = within(drawer).getAllByRole('button').length + 1;
    for (let step = 0; step < stops * 2; step += 1) {
      await user.tab();
      expect(drawer.contains(document.activeElement), String(step)).toBe(true);
    }
  });

  it('focus returns to the alerts button on close', async () => {
    const user = userEvent.setup();
    renderHarness();
    const button = screen.getByRole('button', { name: '2 alertas' });

    await openDrawer(user);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(button).toHaveFocus();

    await openDrawer(user);
    await user.click(document.querySelector('[data-occ-drawer-scrim]'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    // Also when the click that opened it left focus elsewhere, as some browsers do with buttons.
    screen.getByRole('button', { name: 'Otra cosa' }).focus();
    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Alertas y avisos' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(button).toHaveFocus();
  });

  it('shows the notices state: loading, recoverable error and no permission', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const view = render(<AlertsHarness shell={createOccShellValue({ notices: { status: 'error', items: [], retry } })} />);
    let drawer = await openDrawer(user);
    expect(within(drawer).getByRole('alert')).toHaveTextContent('No se pudieron cargar los avisos.');
    await user.click(within(drawer).getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledOnce();
    view.unmount();

    render(<AlertsHarness shell={createOccShellValue({ notices: { status: 'forbidden', items: [] } })} />);
    drawer = await openDrawer(user);
    expect(drawer).toHaveTextContent('No tienes permiso para ver los avisos.');
    // The history link stays: the page itself says what the account may see.
    expect(within(drawer).getByRole('link', { name: 'Ver historial de avisos' })).toBeInTheDocument();
  });

  it('speaks English inside a translated scope', async () => {
    resetLanguageForTests('en');
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole('button', { name: '2 alerts' }));
    const drawer = screen.getByRole('dialog', { name: 'Alerts and notices' });
    expect(within(drawer).getByRole('region', { name: 'Alerts' })).toBeInTheDocument();
    expect(within(drawer).getByRole('region', { name: 'Recent notices' })).toBeInTheDocument();
    expect(within(drawer).getAllByRole('button', { name: 'Acknowledge' })).toHaveLength(2);
    expect(within(drawer).getByRole('link', { name: 'View notice history' })).toBeInTheDocument();
  });
});
