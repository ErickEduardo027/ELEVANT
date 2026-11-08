import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import {
  closeOperationsWithoutCharge, closureError, getFinancePendingOperations, invoicingError, issueInvoiceFromOperations,
} from '../../../services/invoicingService';
import { businessToday } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { sundayWeek } from '../approved-services/useApprovedServicesData';

export const ITBIS_RATE = 0.18;
/** The limits of one invoice until the server publishes them with the first page (4-N06). */
export const DEFAULT_LIMITS = Object.freeze({ maxOperations: 100, maxLines: 500, maxDays: 31 });
const PAGE_SIZE = 50;
const EMPTY = Object.freeze({ operations: [], nextCursor: null, totalPending: 0, airlines: [], limits: DEFAULT_LIMITS });

/** The calendar month that contains the date, moved by whole months. */
export function calendarMonth(isoDate, offsetMonths = 0) {
  const [year, month] = isoDate.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offsetMonths, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The dates are optional filters (4-N16): empty shows everything pending; a period needs «Hasta» after «Desde». */
function validRange(from, to) {
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return false;
  return !from || !to || from <= to;
}

const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
const dayNumber = isoDate => Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000;

/** A pending operation of the server as the screen keeps it. */
export function toRow(operation) {
  return { ...operation, id: operation.operationId, currency: operation.currencyCode ?? null, estimate: operation.estimatedNet };
}

/**
 * Why `item` cannot join `selected` in one invoice (4-N06), in Spanish, or null when it fits: the same airline and
 * currency, and the server limits of operations, lines and days. Nothing is ever cut silently.
 */
export function selectionProblem(selected, item, limits = DEFAULT_LIMITS) {
  if (selected.some(entry => entry.id === item.id)) return null;
  if (!item.ready) return 'La operación no está lista para facturar: revise su estado.';
  if (selected.length >= limits.maxOperations) return `Una factura admite hasta ${limits.maxOperations} operaciones.`;
  const first = selected[0];
  if (first && first.airlineId !== item.airlineId) return 'Solo se agrupan operaciones de la misma aerolínea.';
  if (first && first.currency !== item.currency) return 'Solo se agrupan operaciones de la misma moneda.';
  const lines = selected.reduce((sum, entry) => sum + entry.lineEstimate, 0) + item.lineEstimate;
  if (lines > limits.maxLines) return `Superaría las ${limits.maxLines} líneas de una factura.`;
  const days = [...selected.map(entry => entry.operationDate), item.operationDate].map(dayNumber);
  if (Math.max(...days) - Math.min(...days) >= limits.maxDays)
    return `Superaría los ${limits.maxDays} días de operaciones de una factura.`;
  return null;
}

export function useToInvoiceData(initialStationId) {
  const accountId = useMemo(() => readSession()?.accountId, []);
  const scopes = useMemo(() => (readSession()?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), []);
  const [stationId, setStationId] = useState(
    scopes.some(scope => scope.stationId === initialStationId) ? initialStationId : scopes[0]?.stationId ?? '');
  // 4-N10: the periods start from the business day of Santo Domingo, never from the browser or UTC day.
  const today = useMemo(() => businessToday(), []);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [airline, setAirline] = useState('all');
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(EMPTY);
  const [status, setStatus] = useState('loading');
  const [stale, setStale] = useState(false);
  const [more, setMore] = useState('idle');
  const [pickedIds, setSelectedIds] = useState([]);
  const [notice, setNotice] = useState(null);
  const [issue, setIssue] = useState({ status: 'idle' });
  const [closure, setClosure] = useState({ status: 'idle' });
  const issueKeys = useRef(createCommandKeyHolder());
  const closeKeys = useRef(createCommandKeyHolder());
  const generation = useRef(0);
  const rangeIsValid = validRange(from, to);
  const filters = useMemo(() => ({ stationId, from: from || null, to: to || null,
    airlineId: airline === 'all' ? null : airline }), [stationId, from, to, airline]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!accountId) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_approved_services')) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); void observer.stop(); };
  }, [accountId, refresh]);

  useEffect(() => {
    if (!stationId || !rangeIsValid) {
      generation.current += 1;
      setStatus(!stationId ? 'forbidden' : 'invalid-range');
      setData(EMPTY);
      return undefined;
    }
    const controller = new AbortController();
    const current = ++generation.current;
    // A revalidation keeps the rows on screen until the new page arrives.
    setStatus(value => (value === 'success' ? 'success' : 'loading'));
    getFinancePendingOperations({ ...filters, limit: PAGE_SIZE }, { signal: controller.signal })
      .then(page => {
        if (controller.signal.aborted || current !== generation.current) return;
        setData({ operations: page.operations.map(toRow), nextCursor: page.nextCursor ?? null,
          totalPending: page.totalPending, airlines: page.airlines, limits: page.limits });
        setStatus('success');
        setStale(false);
        setMore('idle');
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error) || current !== generation.current) return;
        const kind = error?.status === 401 ? 'unauthorized'
          : error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error';
        if (kind !== 'error') setData(EMPTY);
        setStale(kind === 'error');
        setStatus(value => (kind === 'error' && value === 'success' ? 'success' : kind));
      });
    return () => abortForEffectCleanup(controller);
  }, [filters, rangeIsValid, revision, stationId]);

  const operations = data.operations;
  const limits = data.limits ?? DEFAULT_LIMITS;
  // A refresh can invoice or block an operation: only still-ready operations stay selected.
  const selected = useMemo(() => pickedIds.map(id => operations.find(item => item.id === id && item.ready)).filter(Boolean),
    [pickedIds, operations]);
  const selectedIds = useMemo(() => selected.map(item => item.id), [selected]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return operations.filter(item => !normalized || [item.operationCode, item.flightNumber ?? '', item.contractCode ?? '']
      .some(value => value.toLowerCase().includes(normalized)));
  }, [operations, query]);
  const whyNot = item => selectionProblem(selected, item, limits);
  const canSelect = item => whyNot(item) === null;
  const toggle = id => {
    setIssue(current => (current.status === 'issued' ? current : { status: 'idle' }));
    setNotice(null);
    setSelectedIds(current => (current.includes(id) ? current.filter(item => item !== id) : [...selectedIds, id]));
  };
  /** «Toda la aerolínea del período»: from the oldest while they fit in one invoice, and says where it stopped. */
  const selectAirline = () => {
    const first = selected[0] ?? filtered.find(item => item.ready);
    if (!first) return;
    const candidates = filtered.filter(item => item.ready && item.airlineId === first.airlineId && item.currency === first.currency);
    const chosen = [];
    let stop = null;
    for (const item of candidates) {
      stop = selectionProblem(chosen, item, limits);
      if (stop) break;
      chosen.push(item);
    }
    setSelectedIds(chosen.map(item => item.id));
    setNotice(chosen.length < candidates.length
      ? `Se eligieron ${chosen.length} de ${candidates.length} operaciones de ${first.airlineName}: el resto no cabe en una factura. ${stop} Emita esta factura y continúe con las demás.`
      : null);
  };
  const net = round2(selected.reduce((sum, item) => sum + item.estimate, 0));
  const summary = { count: selected.length, airlineName: selected[0]?.airlineName ?? null, currency: selected[0]?.currency ?? null,
    lines: selected.reduce((sum, item) => sum + item.lineEstimate, 0), net, tax: round2(net * ITBIS_RATE),
    total: round2(net * (1 + ITBIS_RATE)) };

  function changeFilters(next) {
    setFrom(next.from);
    setTo(next.to);
    setSelectedIds([]);
    setNotice(null);
  }

  async function loadMore() {
    if (!data.nextCursor || more === 'loading') return;
    const current = generation.current;
    setMore('loading');
    try {
      const page = await getFinancePendingOperations({ ...filters, cursor: data.nextCursor, limit: PAGE_SIZE });
      if (current !== generation.current) return;
      setData(previous => {
        const known = new Set(previous.operations.map(item => item.id));
        return { operations: [...previous.operations, ...page.operations.map(toRow).filter(item => !known.has(item.id))],
          nextCursor: page.nextCursor ?? null, totalPending: page.totalPending, airlines: page.airlines, limits: page.limits };
      });
      setMore('idle');
    } catch (error) {
      if (current !== generation.current) return;
      if (error?.status === 401) setStatus('unauthorized');
      setMore('error');
    }
  }

  async function issueInvoice() {
    if (!selected.length || issue.status === 'issuing') return;
    const operationIds = selected.map(item => item.id).sort();
    const versions = new Map(selected.map(item => [item.id, item.version]));
    const intent = { stationId, operationIds };
    setIssue({ status: 'issuing' });
    try {
      // The key of the intent and the versions it saw are kept while an uncertain result is retried (4-N29).
      const invoice = await issueKeys.current.run('issue', intent,
        (key, command) => issueInvoiceFromOperations({ ...command, requestId: key }),
        () => ({ ...intent, operationVersions: operationIds.map(id => ({ operationId: id, version: versions.get(id) })) }));
      setSelectedIds([]);
      setNotice(null);
      setIssue({ status: 'issued', invoice, airlineName: summary.airlineName });
      refresh();
    } catch (error) {
      if (error?.code === 'zero_total') {
        // 4-N07: nothing was issued; Finance can close them without charge with a reason.
        setIssue({ status: 'zero', message: invoicingError(error),
          operations: selected.map(item => ({ id: item.id, version: item.version, operationCode: item.operationCode })) });
        return;
      }
      setIssue({ status: 'error', message: invoicingError(error) });
      if (error?.status === 409 || error?.status === 422) refresh();
    }
  }

  async function closeWithoutCharge(reason) {
    if (issue.status !== 'zero' || closure.status === 'closing') return false;
    const command = { stationId, reason: reason.trim(),
      operations: issue.operations.map(item => ({ operationId: item.id, version: item.version })) };
    setClosure({ status: 'closing' });
    try {
      const result = await closeKeys.current.run('no-charge', command, key => closeOperationsWithoutCharge(command, key));
      setClosure({ status: 'idle' });
      setSelectedIds([]);
      setIssue({ status: 'closed', count: result.operationIds.length });
      refresh();
      return true;
    } catch (error) {
      setClosure({ status: 'error', message: closureError(error) });
      if (error?.status === 409 || error?.status === 422) refresh();
      return false;
    }
  }

  return {
    status, stale, operations: filtered, totalLoaded: operations.length, totalPending: data.totalPending,
    hasMore: Boolean(data.nextCursor), more, loadMore, limits, airlines: data.airlines,
    scopes, stationId, setStationId: value => { setStationId(value); setSelectedIds([]); setNotice(null); },
    from, setFrom: value => changeFilters({ from: value, to }), to, setTo: value => changeFilters({ from, to: value }),
    setWeek: offset => changeFilters(sundayWeek(today, offset)), setMonth: offset => changeFilters(calendarMonth(today, offset)),
    clearPeriod: () => changeFilters({ from: '', to: '' }),
    airline, setAirline: value => { setAirline(value); setSelectedIds([]); setNotice(null); }, query, setQuery,
    selectedIds, canSelect, whyNot, toggle, selectAirline, notice,
    clearSelection: () => { setSelectedIds([]); setNotice(null); }, summary,
    issue, issueInvoice, dismissIssue: () => setIssue({ status: 'idle' }),
    closure, closeWithoutCharge, resetClosure: () => setClosure({ status: 'idle' }),
    retry: refresh,
  };
}
