import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewQueueTable from './ReviewQueueTable';

function buildOperation(id, overrides = {}) {
  return {
    id,
    status: 'PENDING_REVIEW',
    priority: 'NORMAL',
    flight: { number: id, airline: 'Arajet', origin: 'MIA', destination: 'PUJ' },
    position: 'A5',
    agent: { name: 'Carlos Medina' },
    supervisor: { name: 'Juan Pérez' },
    schedule: { sta: '2026-08-05T14:20:00-04:00' },
    submittedAt: '2026-08-05T15:45:00-04:00',
    incidents: [],
    planned: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: [], duration: 80, supervisor: 'Juan Pérez' },
    actual: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: [], duration: 80, supervisor: 'Juan Pérez' },
    signatures: [],
    reconciliation: [],
    ...overrides,
  };
}

const OPERATIONS = [buildOperation('DM161'), buildOperation('AA904')];

describe('ReviewQueueTable', () => {
  it('renders one row per operation', () => {
    render(
      <ReviewQueueTable
        operations={OPERATIONS}
        now="2026-08-05T16:00:00-04:00"
        selectedIds={new Set()}
        onToggleSelect={() => {}}
        onToggleSelectAll={() => {}}
        onOpenDetail={() => {}}
        onQuickApprove={() => {}}
        onQuickReturn={() => {}}
      />
    );
    expect(screen.getAllByTestId('review-queue-row')).toHaveLength(2);
  });

  it('the select-all checkbox calls onToggleSelectAll with every visible id', async () => {
    const onToggleSelectAll = vi.fn();
    render(
      <ReviewQueueTable
        operations={OPERATIONS}
        now="2026-08-05T16:00:00-04:00"
        selectedIds={new Set()}
        onToggleSelect={() => {}}
        onToggleSelectAll={onToggleSelectAll}
        onOpenDetail={() => {}}
        onQuickApprove={() => {}}
        onQuickReturn={() => {}}
      />
    );
    await userEvent.click(screen.getByLabelText('Seleccionar todas las operaciones visibles'));
    expect(onToggleSelectAll).toHaveBeenCalledWith(['DM161', 'AA904']);
  });

  it('checks the select-all checkbox when every visible operation is already selected', () => {
    render(
      <ReviewQueueTable
        operations={OPERATIONS}
        now="2026-08-05T16:00:00-04:00"
        selectedIds={new Set(['DM161', 'AA904'])}
        onToggleSelect={() => {}}
        onToggleSelectAll={() => {}}
        onOpenDetail={() => {}}
        onQuickApprove={() => {}}
        onQuickReturn={() => {}}
      />
    );
    expect(screen.getByLabelText('Seleccionar todas las operaciones visibles')).toBeChecked();
  });
});