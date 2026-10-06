import { describe, expect, it } from 'vitest';
import {
  buildPlanningVsExecutionRows,
  buildReconciliationRows,
  canQuickApprove,
  computeKpis,
  computeTabCounts,
  formatDuration,
  formatWaitingTime,
  getFilterOptions,
  hasCriticalDiscrepancy,
  hasMissingSignature,
  hasVisibleIncidents,
} from './reviewMappers';

function buildOperation(overrides = {}) {
  return {
    id: 'REV-TEST',
    status: 'PENDING_REVIEW',
    flight: { number: 'DM161', airline: 'Arajet' },
    agent: { name: 'Carlos Medina' },
    supervisor: { name: 'Juan Pérez' },
    position: 'A5',
    approvedAt: null,
    planned: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU', 'Baggage'], duration: 80, supervisor: 'Juan Pérez' },
    actual: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU', 'Baggage'], duration: 80, supervisor: 'Juan Pérez' },
    services: [],
    incidents: [],
    signatures: [
      { name: 'Aerolínea', role: 'Representante de aerolínea', status: 'signed' },
      { name: 'Agente', role: 'Agente de rampa', status: 'signed' },
      { name: 'Supervisor', role: 'Supervisor', status: 'signed' },
    ],
    reconciliation: [],
    ...overrides,
  };
}

describe('formatWaitingTime', () => {
  it('formats a sub-hour wait in minutes', () => {
    expect(formatWaitingTime('2026-08-05T15:00:00-04:00', '2026-08-05T15:18:00-04:00')).toBe('18 min');
  });

  it('formats a multi-hour wait in hours and minutes', () => {
    expect(formatWaitingTime('2026-08-05T10:00:00-04:00', '2026-08-05T12:15:00-04:00')).toBe('2h 15min');
  });

  it('returns "Sin registro" when there is no submission timestamp', () => {
    expect(formatWaitingTime(null, '2026-08-05T12:00:00-04:00')).toBe('Sin registro');
  });
});

describe('formatDuration', () => {
  it('formats minutes under an hour', () => {
    expect(formatDuration(45)).toBe('45 min');
  });

  it('formats minutes over an hour as hours and minutes', () => {
    expect(formatDuration(90)).toBe('1h 30min');
  });
});

describe('buildPlanningVsExecutionRows', () => {
  it('marks every field as matching when planned equals actual', () => {
    const rows = buildPlanningVsExecutionRows(buildOperation());
    expect(rows.every(row => row.tone === 'match')).toBe(true);
  });

  it('flags a position mismatch as critical', () => {
    const operation = buildOperation({ actual: { ...buildOperation().actual, position: 'B21' } });
    const rows = buildPlanningVsExecutionRows(operation);
    expect(rows.find(row => row.key === 'position').tone).toBe('critical');
  });

  it('flags a small start-time drift as attention and a large one as critical', () => {
    const smallDrift = buildOperation({ actual: { ...buildOperation().actual, startTime: '2026-08-05T14:27:00-04:00' } });
    const bigDrift = buildOperation({ actual: { ...buildOperation().actual, startTime: '2026-08-05T14:45:00-04:00' } });
    expect(buildPlanningVsExecutionRows(smallDrift).find(row => row.key === 'startTime').tone).toBe('attention');
    expect(buildPlanningVsExecutionRows(bigDrift).find(row => row.key === 'startTime').tone).toBe('critical');
  });

  it('flags any agent count mismatch as critical', () => {
    const operation = buildOperation({ actual: { ...buildOperation().actual, agents: 4 } });
    const rows = buildPlanningVsExecutionRows(operation);
    expect(rows.find(row => row.key === 'agents').tone).toBe('critical');
  });

  it('flags a missing planned service as critical', () => {
    const operation = buildOperation({ actual: { ...buildOperation().actual, services: ['GPU'] } });
    const rows = buildPlanningVsExecutionRows(operation);
    expect(rows.find(row => row.key === 'services').tone).toBe('critical');
  });
});

describe('buildReconciliationRows', () => {
  it('flags a one-unit surplus as attention and a two-unit surplus as critical', () => {
    const operation = buildOperation({
      reconciliation: [
        { concept: 'GPU', unit: 'unidad', contracted: 1, executed: 2 },
        { concept: 'Baggage Handling', unit: 'agentes', contracted: 2, executed: 4 },
      ],
    });
    const rows = buildReconciliationRows(operation);
    expect(rows[0].tone).toBe('attention');
    expect(rows[1].tone).toBe('critical');
  });
});

describe('hasCriticalDiscrepancy / canQuickApprove', () => {
  it('is false for a clean operation and allows quick approve', () => {
    const operation = buildOperation();
    expect(hasCriticalDiscrepancy(operation)).toBe(false);
    expect(canQuickApprove(operation)).toBe(true);
  });

  it('is true when planning vs execution has a critical row, and blocks quick approve', () => {
    const operation = buildOperation({ actual: { ...buildOperation().actual, agents: 3 } });
    expect(hasCriticalDiscrepancy(operation)).toBe(true);
    expect(canQuickApprove(operation)).toBe(false);
  });

  it('blocks quick approve for operations that are not pending review, even if clean', () => {
    const operation = buildOperation({ status: 'IN_REVIEW' });
    expect(canQuickApprove(operation)).toBe(false);
  });
});

describe('hasMissingSignature / hasVisibleIncidents', () => {
  it('detects a pending signature', () => {
    const operation = buildOperation({ signatures: [{ name: 'Supervisor', role: 'Supervisor', status: 'pending' }] });
    expect(hasMissingSignature(operation)).toBe(true);
  });

  it('detects visible incidents', () => {
    const operation = buildOperation({ incidents: [{ id: 'INC-1', severity: 'medium', status: 'open' }] });
    expect(hasVisibleIncidents(operation)).toBe(true);
  });
});

describe('computeKpis / computeTabCounts', () => {
  const today = new Date().toISOString();
  const operations = [
    buildOperation({ id: 'a', status: 'PENDING_REVIEW' }),
    buildOperation({ id: 'b', status: 'PENDING_REVIEW' }),
    buildOperation({ id: 'c', status: 'IN_REVIEW' }),
    buildOperation({ id: 'd', status: 'APPROVED', approvedAt: today }),
    buildOperation({ id: 'e', status: 'APPROVED', approvedAt: '2020-01-01T00:00:00Z' }),
    buildOperation({ id: 'f', status: 'RETURNED' }),
    buildOperation({ id: 'g', status: 'RESUBMITTED' }),
  ];

  it('computes KPI counts, counting only approvals stamped today', () => {
    expect(computeKpis(operations)).toEqual({ pending: 2, inReview: 1, approvedToday: 1, returned: 1 });
  });

  it('computes a count per tab', () => {
    expect(computeTabCounts(operations)).toEqual({ pending: 2, inReview: 1, approved: 2, returned: 1, resubmitted: 1 });
  });
});

describe('getFilterOptions', () => {
  it('collects unique, sorted values for each facet', () => {
    const operations = [
      buildOperation({ flight: { number: 'DM161', airline: 'Arajet' }, agent: { name: 'Carlos' }, position: 'A5' }),
      buildOperation({ flight: { number: 'AA904', airline: 'American' }, agent: { name: 'Ana' }, position: 'B21' }),
    ];
    const options = getFilterOptions(operations);
    expect(options.airlines).toEqual(['American', 'Arajet']);
    expect(options.agents).toEqual(['Ana', 'Carlos']);
    expect(options.positions).toEqual(['A5', 'B21']);
  });
});