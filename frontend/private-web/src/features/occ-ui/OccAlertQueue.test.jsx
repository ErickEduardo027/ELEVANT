import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { buildAlertQueue } from '../dashboard/noc/alertModel';
import OccAlertQueue from './OccAlertQueue';

const ZONE = 'America/Santo_Domingo';
const RECEIVED_AT = '2026-11-12T18:32:00Z'; // 14:32 in Punta Cana

// Synthetic notices in the shape of OperationalNotificationResponse, with invented ids.
let sequence = 0;
function notice(kind, overrides = {}) {
  sequence += 1;
  const suffix = String(sequence).padStart(12, '0');
  return { id: `94000000-0000-4000-8000-${suffix}`, operationId: `74000000-0000-4000-8000-${suffix}`,
    operationCode: `OP-${500 + sequence}`, stationCode: 'PUJ', kind, sourceId: `84000000-0000-4000-8000-${suffix}`,
    occurredAt: '2026-11-12T18:28:00Z', readAt: null, ...overrides };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function queue(items, props = {}) {
  const { alerts, recent } = buildAlertQueue(items);
  return (
    <LanguageScope>
      <OccAlertQueue alerts={alerts} recent={recent} status="success" onAcknowledge={vi.fn()} onOpen={vi.fn()}
        onRetry={vi.fn()} timeZone={ZONE} {...props} />
    </LanguageScope>
  );
}

// A queue whose «Recibido» writes the receipt into its own notices, as the shell does with the server's answer.
function ReceivingQueue({ initial, onReceipt = () => {} }) {
  const [items, setItems] = useState(initial);
  const { alerts, recent } = buildAlertQueue(items);
  const acknowledge = async entry => {
    await Promise.resolve();
    onReceipt(entry.id);
    setItems(current => current.map(item => (item.id === entry.id ? { ...item, readAt: RECEIVED_AT } : item)));
  };
  return (
    <LanguageScope>
      <OccAlertQueue alerts={alerts} recent={recent} onAcknowledge={acknowledge} onOpen={() => {}} timeZone={ZONE} />
      <button type="button">Fuera de la cola</button>
    </LanguageScope>
  );
}

const rowOf = element => element.closest('li');
const codeOf = element => rowOf(element).querySelector('[data-occ-plate]').textContent;

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

describe('OccAlertQueue', () => {
  it('lists the unreceived alerts first, the received ones after and the notices under Avisos recientes', () => {
    const items = [
      notice('operation_submitted', { operationCode: 'OP-N1' }),
      notice('deviation_reported', { operationCode: 'OP-A1', occurredAt: '2026-11-12T18:20:00Z' }),
      notice('incident_reported', { operationCode: 'OP-U1', occurredAt: '2026-11-12T18:10:00Z' }),
      notice('contract_not_in_force', { operationCode: 'OP-R1', readAt: RECEIVED_AT }),
    ];
    render(queue(items));
    const alerts = screen.getByRole('region', { name: 'Alertas' });
    expect(within(alerts).getByText('2 sin recibir')).toBeInTheDocument();
    const rows = within(alerts).getAllByRole('listitem');
    expect(rows.map(row => row.querySelector('[data-occ-plate]').textContent)).toEqual(['OP-U1', 'OP-A1', 'OP-R1']);
    expect(rows.map(row => row.dataset.received)).toEqual(['false', 'false', 'true']);

    // Each row: its glyph and priority word, what happened, the operation plate and the local time.
    expect(rows[0]).toHaveTextContent('Urgente');
    expect(rows[0]).toHaveTextContent('Incidencia reportada en rampa');
    expect(rows[0].querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'octagon');
    expect(within(rows[0]).getByText('14:10')).toHaveAttribute('datetime', '2026-11-12T18:10:00Z');
    expect(rows[1]).toHaveTextContent('Atención');
    // Unreceived alerts keep their signal's slab; a received one is calm.
    expect(rows[0].className).toContain('bg-occ-danger-soft');
    expect(rows[1].className).toContain('bg-occ-warn-soft');
    expect(rows[2].className).not.toMatch(/warn|danger/);

    // Both buttons keep their short names and are described by their row.
    const acknowledge = within(rows[0]).getByRole('button', { name: 'Recibido' });
    expect(acknowledge).toHaveAccessibleDescription('Urgente 14:10 Incidencia reportada en rampa OP-U1');
    expect(within(rows[0]).getByRole('button', { name: 'Abrir' }))
      .toHaveAccessibleDescription('Urgente 14:10 Incidencia reportada en rampa OP-U1');

    const recent = screen.getByRole('region', { name: 'Avisos recientes' });
    const [notices] = [within(recent).getAllByRole('listitem')];
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent('Aviso');
    expect(notices[0]).toHaveTextContent('Operación entregada para revisión');
    // A plain notice only opens.
    expect(within(notices[0]).getAllByRole('button').map(button => button.textContent)).toEqual(['Abrir']);
  });

  it('Recibido calls the read receipt once even when pressed twice', async () => {
    const user = userEvent.setup();
    const answer = deferred();
    const onAcknowledge = vi.fn(() => answer.promise);
    const incident = notice('incident_reported');
    render(queue([incident], { onAcknowledge }));
    const button = screen.getByRole('button', { name: 'Recibido' });

    await user.click(button);
    await user.click(button);
    await user.keyboard('{Enter}');
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(onAcknowledge.mock.calls[0][0]).toMatchObject({ id: incident.id, priority: 'urgent', notice: incident });
    // Waiting, it is disabled for assistive technology and keeps its focus, so the controller does not lose the place.
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveFocus();

    await act(async () => { answer.resolve({ ...incident, readAt: RECEIVED_AT }); });
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('a failed Recibido keeps the alert unreceived and shows its message', async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn()
      .mockRejectedValueOnce(new Error('No fue posible completar la solicitud. Comprueba la conexión e intenta nuevamente.'))
      .mockResolvedValueOnce({});
    render(queue([notice('agent_released')], { onAcknowledge }));
    const button = screen.getByRole('button', { name: 'Recibido' });
    await user.click(button);

    const message = await screen.findByRole('alert');
    expect(message).toHaveTextContent('No se pudo marcar como recibida. Vuelve a intentarlo.');
    // Never the server's text.
    expect(screen.queryByText(/No fue posible/)).not.toBeInTheDocument();
    expect(rowOf(button)).toContainElement(message);
    expect(rowOf(button)).toHaveAttribute('data-received', 'false');
    expect(screen.getByText('1 sin recibir')).toBeInTheDocument();
    // It can be pressed again, from where it was.
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveFocus();

    await user.click(button);
    expect(onAcknowledge).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a received alert says Recibida a las 14:32', () => {
    const received = notice('incident_reported', { readAt: RECEIVED_AT, operationCode: 'OP-0412' });
    const view = render(queue([received]));
    const row = rowOf(screen.getByText('OP-0412'));
    expect(within(row).getByText('Recibida a las 14:32')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Recibido' })).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Abrir' })).toBeInTheDocument();
    // Nothing left to receive.
    expect(screen.getByText('No hay alertas sin atender.')).toBeInTheDocument();
    view.unmount();

    resetLanguageForTests('en');
    render(queue([received]));
    expect(screen.getByText('Acknowledged at 14:32')).toBeInTheDocument();
    expect(screen.getByText('No alerts need attention.')).toBeInTheDocument();
  });

  it('moves focus to the next Recibido after receiving', async () => {
    const user = userEvent.setup();
    const items = [
      notice('incident_reported', { operationCode: 'OP-U1', occurredAt: '2026-11-12T18:30:00Z' }),
      notice('deviation_reported', { operationCode: 'OP-A1', occurredAt: '2026-11-12T18:20:00Z' }),
      notice('agent_released', { operationCode: 'OP-A2', occurredAt: '2026-11-12T18:10:00Z' }),
    ];
    render(<ReceivingQueue initial={items} />);
    const receive = async () => {
      await user.keyboard('{Enter}');
      await act(async () => {});
    };

    screen.getAllByRole('button', { name: 'Recibido' })[0].focus();
    await receive();
    expect(document.activeElement).toHaveAccessibleName('Recibido');
    expect(codeOf(document.activeElement)).toBe('OP-A1');
    expect(screen.getByText('2 sin recibir')).toBeInTheDocument();

    // Receiving the last of the list hands focus back to the one before it.
    screen.getAllByRole('button', { name: 'Recibido' })[1].focus();
    expect(codeOf(document.activeElement)).toBe('OP-A2');
    await receive();
    expect(codeOf(document.activeElement)).toBe('OP-A1');

    // With none left, focus goes to the title, which says nothing is waiting.
    await receive();
    expect(screen.queryByRole('button', { name: 'Recibido' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alertas' })).toHaveFocus();
    expect(screen.getByText('No hay alertas sin atender.')).toBeInTheDocument();
  });

  it('leaves focus where the controller moved it while the receipt was on its way', async () => {
    const user = userEvent.setup();
    const answer = deferred();
    const items = [notice('incident_reported'), notice('deviation_reported')];
    function Slow() {
      const [list, setList] = useState(items);
      const { alerts, recent } = buildAlertQueue(list);
      const acknowledge = async entry => {
        await answer.promise;
        setList(current => current.map(item => (item.id === entry.id ? { ...item, readAt: RECEIVED_AT } : item)));
      };
      return (
        <LanguageScope>
          <OccAlertQueue alerts={alerts} recent={recent} onAcknowledge={acknowledge} timeZone={ZONE} />
          <button type="button">Fuera de la cola</button>
        </LanguageScope>
      );
    }
    render(<Slow />);
    await user.click(screen.getAllByRole('button', { name: 'Recibido' })[0]);
    const outside = screen.getByRole('button', { name: 'Fuera de la cola' });
    outside.focus();
    await act(async () => { answer.resolve(); });
    expect(screen.getAllByRole('button', { name: 'Recibido' })).toHaveLength(1);
    expect(outside).toHaveFocus();
  });

  it('only an unreceived urgent glyph carries the motion-safe blink class', () => {
    render(queue([
      notice('incident_reported', { operationCode: 'OP-U' }),
      notice('incident_reported', { operationCode: 'OP-RU', readAt: RECEIVED_AT }),
      notice('deviation_reported', { operationCode: 'OP-A' }),
      notice('flight_changed', { operationCode: 'OP-N' }),
    ]));
    const glyphs = [...document.querySelectorAll('[data-occ-glyph]')];
    const blinking = glyphs.filter(glyph => glyph.getAttribute('class').includes('motion-safe:animate-occ-alarm-blink'));
    expect(blinking.map(glyph => codeOf(glyph))).toEqual(['OP-U']);
    // Under reduced motion it keeps still, with a static second outline instead.
    expect(blinking[0].getAttribute('class')).toContain('motion-reduce:outline-occ-danger');
    expect(blinking[0].getAttribute('class')).not.toMatch(/(?:^|\s)animate-/);
    for (const glyph of glyphs.filter(item => !blinking.includes(item))) {
      expect(glyph.getAttribute('class'), codeOf(glyph)).not.toContain('animate-');
    }
  });

  it('shows loading, recoverable error with Reintentar, no-permission and No hay alertas sin atender.', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const view = render(queue([], { status: 'loading', onRetry }));
    expect(screen.getByRole('status')).toHaveTextContent('Cargando avisos…');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    // Before the first read it claims no empty list.
    expect(screen.queryByText('No hay alertas sin atender.')).not.toBeInTheDocument();

    for (const status of ['error', 'timeout']) {
      view.rerender(queue([], { status, onRetry }));
      expect(screen.getByRole('alert'), status).toHaveTextContent('No se pudieron cargar los avisos.');
      await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    }
    expect(onRetry).toHaveBeenCalledTimes(2);

    for (const status of ['forbidden', 'unauthorized']) {
      view.rerender(queue([], { status, onRetry }));
      expect(screen.getByText('No tienes permiso para ver los avisos.'), status).toBeInTheDocument();
      expect(screen.queryByRole('button'), status).not.toBeInTheDocument();
    }

    view.rerender(queue([], { status: 'empty', onRetry }));
    expect(screen.getByRole('region', { name: 'Alertas' })).toHaveTextContent('No hay alertas sin atender.');
    expect(screen.getByRole('region', { name: 'Avisos recientes' })).toHaveTextContent('No hay avisos recientes.');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

    // A list kept after a failed refresh says since when, and offers to read again.
    view.rerender(queue([notice('deviation_reported')], { status: 'success', onRetry,
      staleSince: '2026-11-12T18:02:00Z' }));
    expect(screen.getByText('Sin actualizar desde las 14:02')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Recibido' })).toBeInTheDocument();
  });

  it('opens an alert or a notice through onOpen', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const deviation = notice('deviation_reported');
    const started = notice('operation_started');
    render(queue([deviation, started], { onOpen }));
    const [alertOpen, noticeOpen] = screen.getAllByRole('button', { name: 'Abrir' });
    await user.click(alertOpen);
    await user.click(noticeOpen);
    expect(onOpen.mock.calls.map(([entry]) => entry.notice)).toEqual([deviation, started]);
  });

  it('rejects a variant it does not draw', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(queue([], { variant: 'wall' }))).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
