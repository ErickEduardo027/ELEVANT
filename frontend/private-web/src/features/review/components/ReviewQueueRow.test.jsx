import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewQueueRow from './ReviewQueueRow';

function buildOperation(overrides = {}) {
  return {
    id: 'REV-1001',
    status: 'PENDING_REVIEW',
    priority: 'NORMAL',
    flight: { number: 'DM161', airline: 'Arajet', origin: 'MIA', destination: 'PUJ' },
    position: 'A5',
    agent: { name: 'Carlos Medina' },
    supervisor: { name: 'Juan Pérez' },
    schedule: { sta: '2026-08-05T14:20:00-04:00' },
    submittedAt: '2026-08-05T15:45:00-04:00',
    incidents: [],
    planned: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    actual: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    signatures: [],
    reconciliation: [],
    ...overrides,
  };
}

function renderRow(operation, props = {}) {
  return render(
    <table>
      <tbody>
        <ReviewQueueRow
          operation={operation}
          now="2026-08-05T16:03:00-04:00"
          selected={false}
          onToggleSelect={() => {}}
          onOpenDetail={() => {}}
          onQuickApprove={() => {}}
          onQuickReturn={() => {}}
          {...props}
        />
      </tbody>
    </table>
  );
}

describe('ReviewQueueRow', () => {
  it('renders the flight, route, position, agent, and supervisor', () => {
    renderRow(buildOperation());
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('Arajet')).toBeInTheDocument();
    expect(screen.getByText('MIA → PUJ')).toBeInTheDocument();
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('Carlos Medina')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('shows the incident count when incidents exist, and a dash otherwise', () => {
    const { rerender } = renderRow(buildOperation());
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(
      <table>
        <tbody>
          <ReviewQueueRow
            operation={buildOperation({ incidents: [{ id: 'INC-1' }, { id: 'INC-2' }] })}
            now="2026-08-05T16:03:00-04:00"
            selected={false}
            onToggleSelect={() => {}}
            onOpenDetail={() => {}}
            onQuickApprove={() => {}}
            onQuickReturn={() => {}}
          />
        </tbody>
      </table>
    );
    expect(screen.getByText('2 incidencias')).toBeInTheDocument();
  });

  it('calls onOpenDetail when the row is clicked', async () => {
    const onOpenDetail = vi.fn();
    renderRow(buildOperation(), { onOpenDetail });
    await userEvent.click(screen.getByText('DM161'));
    expect(onOpenDetail).toHaveBeenCalledWith('REV-1001');
  });

  it('toggles selection via the checkbox without opening the detail', async () => {
    const onToggleSelect = vi.fn();
    const onOpenDetail = vi.fn();
    renderRow(buildOperation(), { onToggleSelect, onOpenDetail });
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledWith('REV-1001');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('disables the quick Aprobar action when a critical discrepancy exists', async () => {
    renderRow(buildOperation({ actual: { ...buildOperation().actual, agents: 3 } }));
    await userEvent.click(screen.getByRole('button', { name: /acciones para dm161/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Aprobar' })).toBeDisabled();
  });

  it('enables the quick Aprobar action and calls onQuickApprove for a clean pending operation', async () => {
    const onQuickApprove = vi.fn();
    renderRow(buildOperation(), { onQuickApprove });
    await userEvent.click(screen.getByRole('button', { name: /acciones para dm161/i }));
    const menu = screen.getByRole('menu');
    const approveItem = within(menu).getByRole('menuitem', { name: 'Aprobar' });
    expect(approveItem).not.toBeDisabled();
    await userEvent.click(approveItem);
    expect(onQuickApprove).toHaveBeenCalledWith('REV-1001');
  });

  it('calls onQuickReturn from the row menu', async () => {
    const onQuickReturn = vi.fn();
    renderRow(buildOperation(), { onQuickReturn });
    await userEvent.click(screen.getByRole('button', { name: /acciones para dm161/i }));
    const menu = screen.getByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Devolver' }));
    expect(onQuickReturn).toHaveBeenCalledWith('REV-1001');
  });
});
