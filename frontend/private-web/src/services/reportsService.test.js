import { describe, expect, it } from 'vitest';
import {
  classifyClosureSeverity,
  classifyGroundTimeStatus,
  classifyReconciliationStatus,
  exportReport,
  getClosureReport,
  getGroundTimeReport,
  getOperationalSummary,
  getReconciliationReport,
} from './reportsService';

describe('classifyClosureSeverity', () => {
  it('classifies below the critical threshold as critical', () => {
    expect(classifyClosureSeverity(7)).toBe('critical');
  });

  it('classifies between the critical and warning threshold as warning', () => {
    expect(classifyClosureSeverity(18)).toBe('warning');
  });

  it('classifies at or above the warning threshold as normal', () => {
    expect(classifyClosureSeverity(32)).toBe('normal');
  });
});

describe('classifyGroundTimeStatus', () => {
  it('is within_sla when actual does not exceed contracted', () => {
    expect(classifyGroundTimeStatus(60, 55)).toBe('within_sla');
  });

  it('is near_limit when actual exceeds contracted but within the buffer', () => {
    expect(classifyGroundTimeStatus(60, 65)).toBe('near_limit');
  });

  it('is exceeded when actual is beyond contracted plus the buffer', () => {
    expect(classifyGroundTimeStatus(60, 80)).toBe('exceeded');
  });
});

describe('classifyReconciliationStatus', () => {
  it('is conforme when executed equals contracted', () => {
    expect(classifyReconciliationStatus(1, 1)).toBe('conforme');
  });

  it('is no_ejecutado when nothing was executed', () => {
    expect(classifyReconciliationStatus(1, 0)).toBe('no_ejecutado');
  });

  it('is diferencia for any other mismatch', () => {
    expect(classifyReconciliationStatus(1, 2)).toBe('diferencia');
  });
});

describe('getClosureReport', () => {
  it('only includes records with a registered position change', async () => {
    const { rows } = await getClosureReport();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.initialPosition).not.toBe(row.finalPosition);
      expect(row.leadTimeMinutes).toEqual(expect.any(Number));
      expect(row.severity).toMatch(/^(normal|warning|critical)$/);
    }
  });

  it('applies airline and terminal filters', async () => {
    const { rows } = await getClosureReport('PUJ', { airline: 'American Airlines' });
    expect(rows.every(row => row.flight.airline === 'American Airlines')).toBe(true);
  });
});

describe('getReconciliationReport', () => {
  it('flattens services into rows with a contracted/executed/diff shape', async () => {
    const { rows } = await getReconciliationReport();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.diff).toBe(row.executedQty - row.contractedQty);
      expect(row.status).toMatch(/^(conforme|diferencia|no_ejecutado)$/);
    }
  });
});

describe('getGroundTimeReport', () => {
  it('computes diffMinutes and a status per record', async () => {
    const { rows } = await getGroundTimeReport();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.diffMinutes).toBe(row.actualMinutes - row.contractedMinutes);
      expect(row.status).toMatch(/^(within_sla|near_limit|exceeded)$/);
    }
  });

  it('respects a date range filter', async () => {
    const all = await getGroundTimeReport();
    const today = all.rows[0].date;
    const { rows } = await getGroundTimeReport('PUJ', { dateFrom: today, dateTo: today });
    expect(rows.every(row => row.date === today)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(all.rows.length);
  });
});

describe('getOperationalSummary', () => {
  it('resolves the full set of operational records for aggregation', async () => {
    const { records } = await getOperationalSummary();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record).toEqual(
        expect.objectContaining({
          flight: expect.objectContaining({ number: expect.any(String), airline: expect.any(String) }),
          groundTime: expect.objectContaining({ contractedMinutes: expect.any(Number), actualMinutes: expect.any(Number) }),
          services: expect.any(Array),
        })
      );
    }
  });
});

describe('exportReport', () => {
  it('resolves with a generated file name matching the requested format', async () => {
    const result = await exportReport({ reportId: 'closure', format: 'pdf' });
    expect(result.fileName).toMatch(/\.pdf$/);
    expect(result.generatedAt).toEqual(expect.any(String));
  });

  it('uses an Excel-compatible xls extension for exports', async () => {
    const result = await exportReport({ reportId: 'closure', format: 'excel' });
    expect(result.fileName).toMatch(/\.xls$/);
  });
});