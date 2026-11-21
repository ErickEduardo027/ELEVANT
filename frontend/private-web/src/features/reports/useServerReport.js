'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile } from '../../utils/downloadFile';
import { computeTotals, periodLabel, presetRange, rangeDays } from './reportModel';

const NO_FILTERS = Object.freeze([]);
const DEFAULT_LABELS = Object.freeze({ period: 'Período', asOf: 'Fecha de corte' });

/** A failure the screen can explain: its sentence (already translated by the service), code and whether to retry. */
function failureOf(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  const kind = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'error';
  return { message: error?.message ?? '', code: typeof error?.code === 'string' ? error.code : undefined, status, kind,
    // 401 sends to the login, 403 is a refusal: retrying either would only fail again.
    retryable: status !== 401 && status !== 403 };
}

/** A catalog entry with every optional field in place: an older API sends no filters, types or cut-off mark. */
function definitionOf(report) {
  return { key: report.key, title: report.title, description: report.description ?? '',
    asOfDate: report.asOfDate === true, filters: Array.isArray(report.filters) ? report.filters : NO_FILTERS,
    columns: report.columns ?? [], columnTypes: report.columnTypes ?? [] };
}

const isAbort = error => error?.name === 'AbortError';

/**
 * The common logic of every report screen (ADR-0048, PR D): the catalog, the filters with their period shortcuts,
 * «Generar», the pages, the totals, «Filtros aplicados» and the PDF and Excel downloads. The skins (occ-ui for OCC,
 * the department pages elsewhere) only draw what it returns.
 *
 * `source` adapts one area's API:
 * - `loadCatalog({ signal })` → `{ reports: [{ key, title, description, asOfDate?, filters?: [{ key, label,
 *   parameter, options }] }], maxRangeDays? }`;
 * - `loadPage(key, query, { signal })` → `{ title, asOf, generatedBy?, columns: [{ label, type }], rows: unknown[][],
 *   page, hasMore, totalRows?, totals?, summary?, appliedFilters?, notes? }`; a column may carry `currencyOf(row)`.
 *   `totals` left out lets the screen add the whole period by type; `null` says the server has none.
 * - `exportReport(key, query, format)` → a Blob of the whole period, and `fileName(key, query, format)`;
 * - `baseParams`: the filters every report takes (station, currency…); `paramsFor(definition)` adds those of one
 *   report; the catalog's own filters always count. Other values stay in the draft but are not sent.
 * - `paged` (default true): whether the API pages the rows.
 * `describe(query, definition)` names the filters of a query for «Filtros aplicados» (`base: true` marks those that
 * go before the period, such as the station); the server's own names replace the others when it sends them.
 */
export function useServerReport({
  source, initialKey, today, initialValues, initialPreset = 'thisMonth', pageSize = 25, enabled = true,
  autoGenerate = false, describe, labels = DEFAULT_LABELS,
}) {
  const paged = source.paged !== false;
  const [catalog, setCatalog] = useState({ status: 'loading', reports: [], maxRangeDays: null, error: null });
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [draft, setDraft] = useState(() => ({ key: initialKey, preset: initialPreset,
    ...(presetRange(initialPreset, today) ?? { from: today, to: today }), values: { ...(initialValues ?? {}) } }));
  const [validation, setValidation] = useState(null);
  const [applied, setApplied] = useState(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState({ status: 'idle', data: null, error: null });
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const exportVersion = useRef(0);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    sourceRef.current.loadCatalog({ signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      const reports = (result?.reports ?? []).map(definitionOf);
      setCatalog({ status: 'success', reports,
        maxRangeDays: Number.isInteger(result?.maxRangeDays) ? result.maxRangeDays : null, error: null });
      // A key the catalog does not list falls back to its first report.
      setDraft(current => (reports.some(item => item.key === current.key) || !reports.length
        ? current : { ...current, key: reports[0].key }));
    }).catch(error => {
      if (!controller.signal.aborted && !isAbort(error))
        setCatalog({ status: 'error', reports: [], maxRangeDays: null, error: failureOf(error) });
    });
    return () => controller.abort();
  }, [catalogAttempt, enabled]);

  const selected = useMemo(() => catalog.reports.find(item => item.key === draft.key) ?? null,
    [catalog.reports, draft.key]);

  /** The query of the draft: only the filters this report takes, and only the date of a cut-off report. */
  const queryOf = useCallback((state, definition) => {
    const allowed = new Set([...(source.baseParams ?? []), ...(source.paramsFor?.(definition) ?? []),
      ...(definition?.filters ?? []).map(filter => filter.parameter)]);
    const values = Object.fromEntries(Object.entries(state.values)
      .filter(([name, value]) => allowed.has(name) && value !== '' && value !== null && value !== undefined));
    return { ...values, from: definition?.asOfDate ? state.to : state.from, to: state.to };
  }, [source]);

  const generate = useCallback(event => {
    event?.preventDefault?.();
    if (!selected) return;
    const query = queryOf(draft, selected);
    const days = rangeDays(query.from, query.to);
    const problem = !query.from || !query.to ? 'missing' : query.from > query.to ? 'order'
      : catalog.maxRangeDays && days > catalog.maxRangeDays ? 'range' : null;
    setValidation(problem);
    if (problem) return;
    exportVersion.current += 1;
    setExporting('');
    setExportError(null);
    setPage(1);
    setReport({ status: 'loading', data: null, error: null });
    setApplied({ key: selected.key, query, definition: selected });
    setAttempt(value => value + 1);
  }, [catalog.maxRangeDays, draft, queryOf, selected]);

  useEffect(() => {
    if (!autoGenerate || autoStarted.current || catalog.status !== 'success' || !selected) return;
    autoStarted.current = true;
    generate();
  }, [autoGenerate, catalog.status, generate, selected]);

  useEffect(() => {
    if (!applied) return undefined;
    const controller = new AbortController();
    const query = paged ? { ...applied.query, page, limit: pageSize } : applied.query;
    sourceRef.current.loadPage(applied.key, query, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setReport({ status: 'success', data, error: null });
    }).catch(error => {
      if (!controller.signal.aborted && !isAbort(error)) setReport({ status: 'error', data: null, error });
    });
    return () => controller.abort();
  }, [applied, attempt, page, pageSize, paged]);

  const turnPage = useCallback(step => {
    setReport(current => ({ ...current, status: 'loading' }));
    setPage(value => Math.max(1, value + step));
  }, []);

  const retry = useCallback(() => {
    if (!applied) return;
    setReport({ status: 'loading', data: null, error: null });
    setAttempt(value => value + 1);
  }, [applied]);

  /** Reads the generated report again, keeping its rows on screen until the new answer replaces them. */
  const refresh = useCallback(() => {
    if (applied) setAttempt(value => value + 1);
  }, [applied]);

  const retryCatalog = useCallback(() => {
    setCatalog({ status: 'loading', reports: [], maxRangeDays: null, error: null });
    setCatalogAttempt(value => value + 1);
  }, []);

  const exportAs = useCallback(async format => {
    if (!applied || exporting) return;
    const version = ++exportVersion.current;
    setExporting(format);
    setExportError(null);
    try {
      const blob = await sourceRef.current.exportReport(applied.key, applied.query, format);
      if (version !== exportVersion.current) return;
      downloadFile(blob, sourceRef.current.fileName(applied.key, applied.query, format));
    } catch (error) {
      if (version === exportVersion.current) setExportError({ ...failureOf(error), format });
    } finally {
      if (version === exportVersion.current) setExporting('');
    }
  }, [applied, exporting]);

  const data = report.status === 'success' ? report.data : null;

  const totals = useMemo(() => {
    if (!data) return null;
    // An API that sends `totals` decides them, also when it sends none (`null`): it knows what adds up.
    if (data.totals !== undefined) return data.totals?.cells?.length ? data.totals : null;
    // Otherwise only the whole period adds up on screen: one page of many would give a false total.
    const whole = !paged || (data.page === 1 && !data.hasMore);
    return whole ? computeTotals(data.columns, data.rows) : null;
  }, [data, paged]);

  const summary = useMemo(() => {
    if (!applied) return [];
    const local = (describe?.(applied.query, applied.definition) ?? []).filter(item => item?.value);
    const period = { label: applied.definition.asOfDate ? labels.asOf : labels.period,
      value: periodLabel(applied.query.from, applied.query.to, { asOfDate: applied.definition.asOfDate }) };
    const server = Array.isArray(data?.appliedFilters) ? data.appliedFilters.filter(item => item?.label && item.value) : [];
    const strip = ({ label, value }) => ({ label, value });
    return [...local.filter(item => item.base).map(strip), period,
      ...(server.length ? server.map(strip) : local.filter(item => !item.base).map(strip))];
  }, [applied, data, describe, labels]);

  const setKey = useCallback(key => { setValidation(null); setDraft(current => ({ ...current, key })); }, []);
  const setPreset = useCallback(preset => {
    setValidation(null);
    setDraft(current => ({ ...current, preset, ...(presetRange(preset, today) ?? {}) }));
  }, [today]);
  const setDate = useCallback((name, value) => {
    setValidation(null);
    setDraft(current => ({ ...current, preset: 'custom', [name]: value }));
  }, []);
  const setValue = useCallback((name, value) => {
    setDraft(current => ({ ...current, values: { ...current.values, [name]: value } }));
  }, []);

  return {
    catalog, retryCatalog, draft, selected, setKey, setPreset, setDate, setValue, validation, generate,
    applied, page, paged, report, failure: report.status === 'error' ? failureOf(report.error) : null, retry, refresh,
    turnPage,
    exportAs, exporting, exportError, totals, summary,
  };
}
