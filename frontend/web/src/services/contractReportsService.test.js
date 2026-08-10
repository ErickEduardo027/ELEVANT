import { describe, expect, it } from 'vitest';
import { buildExcelCompatibleContent, getContractReportsSnapshot, recordContractReportExport } from './contractReportsService';

describe('contractReportsService', () => {
  it('returns contractual aggregates', async () => {
    const snapshot = await getContractReportsSnapshot();
    expect(snapshot.rows).toHaveLength(4);
    expect(snapshot.rows[0]).toHaveProperty('services');
  });

  it('builds an Excel-compatible tabular export and records it', async () => {
    const snapshot = await getContractReportsSnapshot();
    expect(buildExcelCompatibleContent(snapshot.rows)).toContain('Aerolínea\tContratos activos');
    const record = await recordContractReportExport({ format: 'Excel', airline: 'all', user: 'Usuario de Contratos' });
    expect(record.format).toBe('Excel');
    expect(record.exportedAt).toBeTruthy();
  });
});
