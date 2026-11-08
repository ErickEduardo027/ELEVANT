import { describe, expect, it } from 'vitest';
import { formatReportCell, formatReportDate, KIND_LABELS } from './reportLabels';

describe('Gestión Humana report labels (3-N16)', () => {
  it('names each report as its export does', () => {
    expect(KIND_LABELS.expirations).toBe('Vigencias de habilitaciones y permisos');
    expect(Object.keys(KIND_LABELS)).toEqual(['expirations', 'account-movements', 'staff-distribution',
      'qualification-coverage']);
  });

  it('shows the expiring documents and permits in Spanish', () => {
    const permit = { kind: 'Permit', code: 'AirportId', expiresOn: '2026-10-20' };
    expect(formatReportCell('expirations', 'kind', permit)).toBe('Permiso');
    expect(formatReportCell('expirations', 'code', permit)).toBe('Carnet aeroportuario');
    expect(formatReportCell('expirations', 'code', { kind: 'Permit', code: 'RampDriverLicense' }))
      .toBe('Licencia de conducir en rampa');
    // A qualification keeps its equipment code.
    expect(formatReportCell('expirations', 'kind', { kind: 'Qualification' })).toBe('Habilitación');
    expect(formatReportCell('expirations', 'code', { kind: 'Qualification', code: 'GPU' })).toBe('GPU');
    expect(formatReportCell('expirations', 'expiresOn', permit)).toBe('20/10/2026');
  });

  it('shows an account movement in Spanish at the station local time', () => {
    const movement = { kind: 'Deactivated', occurredAt: '2026-10-06T01:00:00Z' };
    expect(formatReportCell('account-movements', 'kind', movement)).toBe('Cuenta desactivada');
    expect(formatReportCell('account-movements', 'kind', { kind: 'Created' })).toBe('Alta de cuenta');
    expect(formatReportCell('account-movements', 'occurredAt', movement)).toBe('05/10/2026, 21:00');
  });

  it('shows shift dates and times without seconds and keeps unknown codes and empty cells honest', () => {
    const shift = { workDate: '2026-08-18', startsAtLocal: '08:00:00', endsAtLocal: '16:30', positionCode: null };
    expect(formatReportCell('staff-distribution', 'workDate', shift)).toBe('18/08/2026');
    expect(formatReportCell('staff-distribution', 'startsAtLocal', shift)).toBe('08:00');
    expect(formatReportCell('staff-distribution', 'endsAtLocal', shift)).toBe('16:30');
    expect(formatReportCell('staff-distribution', 'positionCode', shift)).toBe('—');
    expect(formatReportCell('expirations', 'kind', { kind: 'Medical' })).toBe('Medical');
    expect(formatReportCell('qualification-coverage', 'qualifiedAgents', { qualifiedAgents: 0 })).toBe('0');
    expect(formatReportDate('2026-10-01')).toBe('01/10/2026');
  });
});
