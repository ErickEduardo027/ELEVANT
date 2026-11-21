import { describe, expect, it } from 'vitest';
import {
  computeTotals, filtersSummary, formatGeneratedAt, formatReportValue, isNumericType, matchPreset, PERIOD_PRESETS,
  presetRange, rangeDays, rowsCountText,
} from './reportModel';

describe('period presets in the station calendar', () => {
  const today = '2026-11-21';

  it('offers Hoy, Últimos 7 días, Este mes, Mes anterior and Personalizado', () => {
    expect(PERIOD_PRESETS.map(preset => preset.label)).toEqual(
      ['Hoy', 'Últimos 7 días', 'Este mes', 'Mes anterior', 'Personalizado']);
  });

  it('turns each preset into its dates', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('last7', today)).toEqual({ from: '2026-11-15', to: today });
    expect(presetRange('thisMonth', today)).toEqual({ from: '2026-11-01', to: today });
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('lastMonth', '2026-03-05')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('lastMonth', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('custom', today)).toBeNull();
  });

  it('recognizes the preset of a period, or calls it custom', () => {
    expect(matchPreset('2026-11-01', today, today)).toBe('thisMonth');
    expect(matchPreset('2026-11-15', today, today)).toBe('last7');
    expect(matchPreset('2026-11-02', today, today)).toBe('custom');
  });

  it('counts the days of a period with both ends', () => {
    expect(rangeDays('2026-11-01', '2026-11-30')).toBe(30);
    expect(rangeDays('2026-11-21', '2026-11-21')).toBe(1);
    expect(rangeDays('2026-11-22', '2026-11-21')).toBe(0);
    expect(rangeDays('', '2026-11-21')).toBe(0);
  });
});

describe('figures as the exports write them (ADR-0048)', () => {
  it('formats each column type', () => {
    expect(formatReportValue('1234.5', 'number')).toBe('1,234.5');
    expect(formatReportValue('45', 'number')).toBe('45');
    expect(formatReportValue('1234.5', 'money')).toBe('1,234.50');
    expect(formatReportValue('1234.5', 'money', { currency: 'USD' })).toBe('USD 1,234.50');
    expect(formatReportValue('7.4567', 'percent')).toBe('7.5 %');
    expect(formatReportValue('65', 'duration')).toBe('1:05');
    expect(formatReportValue('2026-11-03', 'date')).toBe('03/11/2026');
    expect(formatReportValue('03/11/2026', 'date')).toBe('03/11/2026');
    expect(formatReportValue('06:30:00', 'time')).toBe('06:30');
    // A UTC instant reads in the station's local time.
    expect(formatReportValue('2026-10-26T12:00:00Z', 'datetime')).toBe('26/10/2026 08:00');
    expect(formatReportValue('Arajet', 'text')).toBe('Arajet');
  });

  it('writes «—» for an empty cell and keeps a value it cannot read', () => {
    expect(formatReportValue('', 'number')).toBe('—');
    expect(formatReportValue(null, 'text')).toBe('—');
    expect(formatReportValue('n/d', 'number')).toBe('n/d');
  });

  it('knows which types are figures', () => {
    expect(['number', 'money', 'percent', 'duration'].every(isNumericType)).toBe(true);
    expect(isNumericType('date')).toBe(false);
  });

  it('says when the report was generated, and by whom when known', () => {
    expect(formatGeneratedAt('2026-10-26T12:00:00Z')).toBe('Generado el 26/10/2026 08:00');
    expect(formatGeneratedAt('2026-10-26T12:00:00Z', { by: 'Ana Pérez' })).toBe('Generado el 26/10/2026 08:00 por Ana Pérez');
    expect(formatGeneratedAt('2026-10-26T12:00:00Z', { by: 'Ana Pérez', locale: 'en-US', template: 'Generated {date} by {by}' }))
      .toBe('Generated 10/26/2026 08:00 by Ana Pérez');
  });
});

describe('totals of a report', () => {
  const columns = [{ label: 'Aerolínea', type: 'text' }, { label: 'Operaciones', type: 'number' },
    { label: '% a tiempo', type: 'percent' }, { label: 'Importe', type: 'money' }];

  it('adds the figure columns, never the percentages', () => {
    const rows = [['Arajet', '3', '50', '10.5'], ['JetBlue', '5', '80', '4.5']];
    expect(computeTotals(columns, rows)).toEqual({ label: 'Total', cells: ['Total', '8', '', '15'] });
  });

  it('does not add money of different currencies', () => {
    const rows = [['Arajet', '3', '50', '10'], ['JetBlue', '5', '80', '4']];
    const currencies = ['USD', 'DOP'];
    expect(computeTotals(columns, rows, { currencyOf: (row, index) => currencies[index] }))
      .toEqual({ label: 'Total', cells: ['Total', '8', '', ''] });
  });

  it('gives nothing when no column adds up or there are no rows', () => {
    expect(computeTotals([{ label: 'Agente', type: 'text' }], [['Ana']])).toBeNull();
    expect(computeTotals(columns, [])).toBeNull();
  });
});

describe('what the result says about itself', () => {
  it('summarizes the applied filters', () => {
    expect(filtersSummary([{ label: 'Estación', value: 'PUJ' }, { label: 'Período', value: '01/11/2026 – 21/11/2026' }]))
      .toBe('Filtros aplicados: Estación PUJ · Período 01/11/2026 – 21/11/2026');
    expect(filtersSummary([])).toBe('');
  });

  it('counts the rows of the period when the server says it, and of the page otherwise', () => {
    expect(rowsCountText({ rows: 25, totalRows: 120, page: 1, paged: true })).toBe('120 filas en el período · página 1');
    expect(rowsCountText({ rows: 1, totalRows: 1, page: 1, paged: true })).toBe('1 fila en el período');
    expect(rowsCountText({ rows: 25, totalRows: null, page: 2, paged: true })).toBe('Página 2 · 25 filas en esta página');
    expect(rowsCountText({ rows: 7, totalRows: null, page: 1, paged: false })).toBe('7 filas en el período');
    expect(rowsCountText({ rows: 0, totalRows: 0, page: 1, paged: true })).toBe('');
  });
});
