import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import {
  closeOperationsWithoutCharge, closureError, getFinancePendingOperations, invoicingError, issueInvoiceFromOperations,
} from '../../../services/invoicingService';
import { businessToday } from '../../../services/businessDay';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { sundayWeek } from './weeks';

export const ITBIS_RATE = 0.18;
/** The limits of one invoice until the server publishes them with the first page (4-N06). */
export const DEFAULT_LIMITS = Object.freeze({ maxOperations: 100, maxLines: 500, maxDays: 31 });
const PAGE_SIZE = 50;
/** «Toda la aerolínea del período» reads the airline's own pages at the largest size the server takes (4-N06). */
const AIRLINE_PAGE_SIZE = 100;
const MAX_AIRLINE_PAGES = 20;
/** 4-N11: the feed resources that change «Por facturar»: an approved or invoiced operation, an issued invoice. */
export const TO_INVOICE_RESOURCES = Object.freeze(['finance_approved_services', 'finance_invoices']);
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

/** From the oldest, the candidates that fit together in one invoice, and why the next one does not (null when all fit). */
function fitting(candidates, limits) {
  const chosen = [];
  for (const item of candidates) {
    const stop = selectionProblem(chosen, item, limits);
    if (stop) return { chosen, stop };
    chosen.push(item);
  }
  return { chosen, stop: null };
}

/** The server's order of «Por facturar»: operation date, operation code and operation id. */
function byPosition(left, right) {
  if (left.operationDate !== right.operationDate) return left.operationDate < right.operationDate ? -1 : 1;
  if (left.operationCode !== right.operationCode) return left.operationCode < right.operationCode ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** The rows on screen with the new ones added once each, in the server's order. */
function merged(rows, more) {
  const byId = new Map(rows.map(item => [item.id, item]));
  for (const item of more) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort(byPosition);
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
  const [picking, setPicking] = useState(false);
  const [issue, setIssue] = useState({ status: 'idle' });
  const [closure, setClosure] = useState({ status: 'idle' });
  const issueKeys = useRef(createCommandKeyHolder());
  const closeKeys = useRef(createCommandKeyHolder());
  const generation = useRef(0);
  // The filters whose rows are on screen. A revalidation of the same filters keeps them until the new page arrives;
  // other filters (another station, airline or period) never show them, nor call them «los datos anteriores».
  const shownFilters = useRef(null);
  const rangeIsValid = validRange(from, to);
  const filters = useMemo(() => ({ stationId, from: from || null, to: to || null,
    airlineId: airline === 'all' ? null : airline }), [stationId, from, to, airline]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!accountId) return undefined;
    // 4-N11: an issuance announces each invoiced operation and the new invoice.
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (TO_INVOICE_RESOURCES.some(resource => resources.includes(resource))) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); void observer.stop(); };
  }, [accountId, refresh]);

  useEffect(() => {
    if (!stationId || !rangeIsValid) {
      generation.current += 1;
      shownFilters.current = null;
      setStatus(!stationId ? 'forbidden' : 'invalid-range');
      setData(EMPTY);
      return undefined;
    }
    const controller = new AbortController();
    const current = ++generation.current;
    const key = JSON.stringify(filters);
    if (shownFilters.current === key) setStatus(value => (value === 'success' ? 'success' : 'loading'));
    else {
      // Other filters: the previous rows leave the screen at once, so none of them can be ticked meanwhile.
      shownFilters.current = null;
      setData(EMPTY);
      setStale(false);
      setMore('idle');
      setStatus('loading');
    }
    getFinancePendingOperations({ ...filters, limit: PAGE_SIZE }, { signal: controller.signal })
      .then(page => {
        if (controller.signal.aborted || current !== generation.current) return;
        shownFilters.current = key;
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
        // Only the rows of these same filters stay, marked as not updated; anything else is the error itself.
        const keep = kind === 'error' && shownFilters.current === key;
        if (!keep) {
          shownFilters.current = null;
          setData(EMPTY);
        }
        setStale(keep);
        setStatus(value => (keep && value === 'success' ? 'success' : kind));
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
  /**
   * «Toda la aerolínea del período»: from the oldest while they fit in one invoice, and says where it stopped (4-N06).
   * The whole period counts, not only the rows loaded: while the server has more pages, the airline's own pages are
   * read first, and the search is cleared so every chosen operation is on screen. Nothing is ever cut silently.
   */
  async function selectAirline() {
    const first = selected[0] ?? filtered.find(item => item.ready);
    if (!first || picking) return;
    const matches = item => item.ready && item.airlineId === first.airlineId && item.currency === first.currency;
    setQuery('');
    let rows = operations;
    let complete = !data.nextCursor;
    let failed = false;
    if (!complete) {
      const current = generation.current;
      const fetched = [];
      let cursor = null;
      setPicking(true);
      setNotice(null);
      try {
        for (let read = 0; read < MAX_AIRLINE_PAGES; read += 1) {
          const page = await getFinancePendingOperations({ ...filters, airlineId: first.airlineId, cursor,
            limit: AIRLINE_PAGE_SIZE });
          if (current !== generation.current) return;
          fetched.push(...page.operations.map(toRow));
          cursor = page.nextCursor ?? null;
          if (!cursor) {
            complete = true;
            break;
          }
          // Once one operation does not fit, no later one does: the invoice is full.
          if (fitting(fetched.filter(matches), limits).stop) break;
        }
      } catch (error) {
        if (current !== generation.current) return;
        if (error?.status === 401) {
          setStatus('unauthorized');
          return;
        }
        failed = true;
      } finally {
        setPicking(false);
      }
      rows = merged(operations, fetched);
      setData(previous => ({ ...previous, operations: merged(previous.operations, fetched) }));
    }
    const candidates = rows.filter(matches);
    const { chosen, stop } = fitting(candidates, limits);
    const airlineName = first.airlineName;
    setSelectedIds(chosen.map(item => item.id));
    if (failed)
      setNotice(`No se pudieron leer todas las operaciones pendientes de ${airlineName}: se eligieron ${chosen.length} de las cargadas. Vuelva a pulsar «Toda la aerolínea del período» para completar la selección.`);
    else if (stop && complete)
      setNotice(`Se eligieron ${chosen.length} de ${candidates.length} operaciones de ${airlineName}: el resto no cabe en una factura. ${stop} Emita esta factura y continúe con las demás.`);
    else if (stop)
      setNotice(`Se eligieron ${chosen.length} operaciones de ${airlineName}, las que caben en una factura; quedan más pendientes. ${stop} Emita esta factura y continúe con las demás.`);
    else if (!complete)
      setNotice(`Se eligieron ${chosen.length} operaciones de ${airlineName}, pero quedan pendientes sin revisar. Emita esta factura y continúe con las demás.`);
    else setNotice(null);
  }
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
      // Rows «Toda la aerolínea del período» already brought keep their place in the server's order.
      setData(previous => ({ operations: merged(previous.operations, page.operations.map(toRow)),
        nextCursor: page.nextCursor ?? null, totalPending: page.totalPending, airlines: page.airlines, limits: page.limits }));
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
    selectedIds, canSelect, whyNot, toggle, selectAirline, picking, notice,
    clearSelection: () => { setSelectedIds([]); setNotice(null); }, summary,
    issue, issueInvoice, dismissIssue: () => setIssue({ status: 'idle' }),
    closure, closeWithoutCharge, resetClosure: () => setClosure({ status: 'idle' }),
    retry: refresh,
  };
}
