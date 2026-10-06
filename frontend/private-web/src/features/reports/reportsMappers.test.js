import { describe, expect, it } from 'vitest';
import {
  buildAgentWorkloadChart,
  buildFlightStatusDistribution,
  buildFlightsByPeriodChart,
  buildServicesByTypeChart,
  computeSummaryKpis,
  formatDateKey,
  formatLeadTime,
  formatPeriodLabel,
  formatSignedMinutes,
  getReportFilterOptions,
  resolveDateRange,
} from './reportsMappers';

const RECORDS = [
  {
    flight: { number: 'DM161', airline: 'Arajet' },
    terminal: 'Terminal A',
    agent: { name: 'Carlos Medina' },
    position: { final: 'A5' },
    date: '2026-08-05',
    flightStatus: 'arrived',
    incidents: 0,
    groundTime: { contractedMinutes: 90, actualMinutes: 82 },
    services: [{ name: 'GPU', contractedQty: 1, executedQty: 1 }],
  },
  {
    flight: { number: 'AA904', airline: 'American Airlines' },
    terminal: 'Terminal A',
    agent: { name: 'María Castillo' },
    position: { final: 'B21' },
    date: '2026-08-05',
    flightStatus: 'delayed',
    incidents: 1,
    groundTime: { contractedMinutes: 60, actualMinutes: 90 },
    services: [
      { name: 'Baggage', contractedQty: 1, executedQty: 1 },
      { name: 'Catering', contractedQty: 1, executedQty: 0 },
    ],
  },
];

describe('resolveDateRange', () => {
  it('resolves "today" to the same from/to date', () => {
    const range = resolveDateRange('today');
    expect(range.from).toBe(range.to);
  });

  it('falls back to the custom range when preset is custom', () => {
    const range = resolveDateRange('custom', '2026-08-01', '2026-08-07');
    expect(range).toEqual({ from: '2026-08-01', to: '2026-08-07' });
  });
});

describe('formatPeriodLabel', () => {
  it('formats a single-day range as one date', () => {
    expect(formatPeriodLabel('2026-08-01', '2026-08-01')).toBe(formatDateKey('2026-08-01'));
  });

  it('formats a multi-day range with an em dash separator', () => {
    expect(formatPeriodLabel('2026-08-01', '2026-08-07')).toBe('01 AGO 2026 — 07 AGO 2026');
  });
});

describe('formatLeadTime / formatSignedMinutes', () => {
  it('formats lead time in minutes', () => {
    expect(formatLeadTime(32)).toBe('32 min');
  });

  it('signs positive and negative deltas, and shows a bare zero', () => {
    expect(formatSignedMinutes(7)).toBe('+7 min');
    expect(formatSignedMinutes(-3)).toBe('-3 min');
    expect(formatSignedMinutes(0)).toBe('0 min');
  });
});

describe('getReportFilterOptions', () => {
  it('extracts unique sorted airlines, agents, terminals and positions', () => {
    const options = getReportFilterOptions(RECORDS);
    expect(options.airlines).toEqual(['American Airlines', 'Arajet']);
    expect(options.agents).toEqual(['Carlos Medina', 'María Castillo']);
    expect(options.terminals).toEqual(['Terminal A']);
    expect(options.positions).toEqual(['A5', 'B21']);
  });
});

describe('computeSummaryKpis', () => {
  it('aggregates flights, services executed, incidents, avg ground time and SLA compliance', () => {
    const kpis = computeSummaryKpis(RECORDS);
    expect(kpis.flightsHandled).toBe(2);
    expect(kpis.servicesExecuted).toBe(2);
    expect(kpis.incidentOperations).toBe(1);
    expect(kpis.avgGroundTimeMinutes).toBe(86);
    expect(kpis.slaCompliancePct).toBe(50);
  });

  it('returns zeroed KPIs for an empty record set', () => {
    expect(computeSummaryKpis([])).toEqual({
      flightsHandled: 0,
      servicesExecuted: 0,
      incidentOperations: 0,
      avgGroundTimeMinutes: 0,
      slaCompliancePct: 0,
    });
  });
});

describe('buildFlightsByPeriodChart', () => {
  it('groups records by date in ascending order', () => {
    expect(buildFlightsByPeriodChart(RECORDS)).toEqual([{ label: '05 AGO', value: 2 }]);
  });
});

describe('buildFlightStatusDistribution', () => {
  it('groups records by flight status', () => {
    const distribution = buildFlightStatusDistribution(RECORDS);
    expect(distribution).toEqual(
      expect.arrayContaining([
        { status: 'arrived', count: 1 },
        { status: 'delayed', count: 1 },
      ])
    );
  });
});

describe('buildServicesByTypeChart', () => {
  it('sums executed quantities per service, sorted descending', () => {
    expect(buildServicesByTypeChart(RECORDS)).toEqual([
      { label: 'GPU', value: 1 },
      { label: 'Baggage', value: 1 },
      { label: 'Catering', value: 0 },
    ]);
  });
});

describe('buildAgentWorkloadChart', () => {
  it('counts operations per agent, sorted descending', () => {
    const workload = buildAgentWorkloadChart(RECORDS);
    expect(workload).toHaveLength(2);
    expect(workload.every(entry => entry.value === 1)).toBe(true);
  });
});