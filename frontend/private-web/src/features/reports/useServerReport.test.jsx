import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useServerReport } from './useServerReport';
import { downloadFile } from '../../utils/downloadFile';

vi.mock('../../utils/downloadFile', () => ({ downloadFile: vi.fn() }));

const catalog = { maxRangeDays: 366, reports: [
  { key: 'operations', title: 'Operaciones', description: 'Cada operación.', asOfDate: false,
    filters: [{ key: 'airline', label: 'Aerolínea', parameter: 'airlineId', options: [] }] },
  { key: 'coverage', title: 'Cobertura', description: 'A la fecha.', asOfDate: true, filters: [] },
] };
const page = (query, extra = {}) => ({ key: 'operations', title: 'Operaciones', asOf: '2026-11-21T12:00:00Z',
  columns: [{ label: 'Aerolínea', type: 'text' }, { label: 'Operaciones', type: 'number' }],
  rows: [['Arajet', '3'], ['JetBlue', '5']], page: query.page ?? 1, hasMore: false, totalRows: 2, summary: [],
  appliedFilters: [], ...extra });

let source;
beforeEach(() => {
  source = {
    loadCatalog: vi.fn(async () => catalog),
    loadPage: vi.fn(async (key, query) => page(query)),
    exportReport: vi.fn(async () => new Blob(['%PDF'])),
    fileName: (key, query, format) => `elevant-${key}-${query.from}-${query.to}.${format}`,
    baseParams: ['stationId'],
  };
});
afterEach(() => vi.clearAllMocks());

const options = extra => ({ source, initialKey: 'operations', today: '2026-11-21', initialValues: { stationId: 'st-1' },
  describe: query => [{ label: 'Estación', value: 'PUJ', base: true },
    ...(query.airlineId ? [{ label: 'Aerolínea', value: 'Arajet' }] : [])], ...extra });

describe('useServerReport', () => {
  it('reads the catalog, starts on «Este mes» and generates the chosen report', async () => {
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    expect(result.current.draft).toMatchObject({ key: 'operations', preset: 'thisMonth', from: '2026-11-01', to: '2026-11-21' });
    expect(result.current.report.status).toBe('idle');

    act(() => result.current.setValue('airlineId', 'air-1'));
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.report.status).toBe('success'));
    expect(source.loadPage).toHaveBeenCalledWith('operations',
      { stationId: 'st-1', airlineId: 'air-1', from: '2026-11-01', to: '2026-11-21', page: 1, limit: 25 },
      expect.objectContaining({ signal: expect.anything() }));
    // The whole period is on screen: the screen adds the totals row by type.
    expect(result.current.totals).toEqual({ label: 'Total', cells: ['Total', '8'] });
    expect(result.current.summary).toEqual([{ label: 'Estación', value: 'PUJ' },
      { label: 'Período', value: '01/11/2026 – 21/11/2026' }, { label: 'Aerolínea', value: 'Arajet' }]);
  });

  it('prefers the filters, totals and summary the server sends', async () => {
    source.loadPage.mockImplementation(async query => page(query, { hasMore: true, totalRows: 40,
      appliedFilters: [{ label: 'Aerolínea', value: 'Arajet (servidor)' }],
      totals: { label: 'Total del período', cells: ['Total del período', '99'] } }));
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => result.current.setValue('airlineId', 'air-1'));
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.report.status).toBe('success'));
    expect(result.current.totals).toEqual({ label: 'Total del período', cells: ['Total del período', '99'] });
    expect(result.current.summary.map(item => item.value)).toEqual(['PUJ', '01/11/2026 – 21/11/2026', 'Arajet (servidor)']);
  });

  it('trusts an API that says a report has no totals', async () => {
    source.loadPage.mockImplementation(async query => page(query, { totals: null }));
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.report.status).toBe('success'));
    expect(result.current.totals).toBeNull();
  });

  it('never adds a page of many: no totals without the server when more pages follow', async () => {
    source.loadPage.mockImplementation(async query => page(query, { hasMore: true, totalRows: 40 }));
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.report.status).toBe('success'));
    expect(result.current.totals).toBeNull();
    act(() => result.current.turnPage(1));
    await waitFor(() => expect(source.loadPage).toHaveBeenLastCalledWith('operations', expect.objectContaining({ page: 2 }),
      expect.anything()));
  });

  it('sends only the date of a cut-off report and drops the filters it does not take', async () => {
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => result.current.setValue('airlineId', 'air-1'));
    act(() => result.current.setKey('coverage'));
    act(() => result.current.generate());
    await waitFor(() => expect(source.loadPage).toHaveBeenCalled());
    expect(source.loadPage.mock.calls[0][1]).toEqual({ stationId: 'st-1', from: '2026-11-21', to: '2026-11-21', page: 1,
      limit: 25 });
    await waitFor(() => expect(result.current.summary).toContainEqual({ label: 'Fecha de corte', value: '21/11/2026' }));
  });

  it('switches the period with its shortcuts and goes custom when a date changes', async () => {
    const { result } = renderHook(() => useServerReport(options()));
    act(() => result.current.setPreset('lastMonth'));
    expect(result.current.draft).toMatchObject({ preset: 'lastMonth', from: '2026-10-01', to: '2026-10-31' });
    act(() => result.current.setDate('from', '2026-10-05'));
    expect(result.current.draft).toMatchObject({ preset: 'custom', from: '2026-10-05', to: '2026-10-31' });
  });

  it('refuses a period that is reversed or too long before asking the server', async () => {
    source.loadCatalog.mockResolvedValue({ ...catalog, maxRangeDays: 30 });
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => { result.current.setDate('from', '2026-09-01'); });
    act(() => result.current.generate());
    expect(result.current.validation).toBe('range');
    act(() => { result.current.setDate('from', '2026-11-30'); });
    act(() => result.current.generate());
    expect(result.current.validation).toBe('order');
    expect(source.loadPage).not.toHaveBeenCalled();
  });

  it('explains a failure by its code and offers no retry for a refusal (403)', async () => {
    source.loadPage.mockRejectedValueOnce(Object.assign(new Error('Revise el período.'),
      { status: 400, code: 'invalid_report_query' }));
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.report.status).toBe('error'));
    expect(result.current.failure).toMatchObject({ code: 'invalid_report_query', message: 'Revise el período.',
      retryable: true, kind: 'error' });

    source.loadPage.mockRejectedValueOnce(Object.assign(new Error('Sin acceso.'), { status: 403 }));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.failure?.kind).toBe('forbidden'));
    expect(result.current.failure.retryable).toBe(false);
  });

  it('downloads the whole period as PDF or Excel with one name, and explains an oversized PDF', async () => {
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.report.status).toBe('success'));
    await act(async () => { await result.current.exportAs('xlsx'); });
    expect(source.exportReport).toHaveBeenCalledWith('operations', { stationId: 'st-1', from: '2026-11-01', to: '2026-11-21' },
      'xlsx');
    expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), 'elevant-operations-2026-11-01-2026-11-21.xlsx');

    source.exportReport.mockRejectedValueOnce(Object.assign(new Error('Demasiadas filas.'),
      { status: 422, code: 'report_too_large' }));
    await act(async () => { await result.current.exportAs('pdf'); });
    expect(result.current.exportError).toMatchObject({ format: 'pdf', code: 'report_too_large', message: 'Demasiadas filas.' });
    expect(result.current.exporting).toBe('');
  });

  it('works without a catalog filter list or typed columns', async () => {
    source.loadCatalog.mockResolvedValue({ reports: [{ key: 'operations', title: 'Operaciones', description: '' }] });
    const { result } = renderHook(() => useServerReport(options({ autoGenerate: true })));
    await waitFor(() => expect(result.current.report.status).toBe('success'));
    expect(result.current.catalog.maxRangeDays).toBeNull();
    expect(result.current.selected.filters).toEqual([]);
  });

  it('refreshes a generated report without clearing it, and drops it when access is revoked', async () => {
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    act(() => result.current.generate());
    await waitFor(() => expect(result.current.report.status).toBe('success'));
    let answer;
    source.loadPage.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    act(() => result.current.refresh());
    expect(result.current.report.status).toBe('success');
    await act(async () => answer(page({ page: 1 }, { rows: [['Arajet', '1']] })));
    expect(result.current.report.data.rows).toEqual([['Arajet', '1']]);
    source.loadPage.mockRejectedValueOnce(Object.assign(new Error('Sin acceso.'), { status: 403 }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.failure?.kind).toBe('forbidden'));
    expect(result.current.report.data).toBeNull();
  });

  it('shows a catalog failure and reads it again', async () => {
    source.loadCatalog.mockRejectedValueOnce(Object.assign(new Error('Sin conexión.'), { status: 503 }));
    const { result } = renderHook(() => useServerReport(options()));
    await waitFor(() => expect(result.current.catalog.status).toBe('error'));
    act(() => result.current.retryCatalog());
    await waitFor(() => expect(result.current.catalog.status).toBe('success'));
    expect(source.loadCatalog).toHaveBeenCalledTimes(2);
  });
});
