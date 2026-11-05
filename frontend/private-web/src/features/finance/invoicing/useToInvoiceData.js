import { useEffect, useMemo, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import { getApprovedServices } from '../../../services/approvedServicesService';
import { issueInvoiceFromOperations, invoicingError } from '../../../services/invoicingService';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { sundayWeek } from '../approved-services/useApprovedServicesData';

export const ITBIS_RATE = 0.18;
const MAX_OPERATIONS = 100;

function localToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** The calendar month that contains the date, moved by whole months (at most 31 days, within the API range). */
export function calendarMonth(isoDate, offsetMonths = 0) {
  const [year, month] = isoDate.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offsetMonths, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

function validRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return days >= 0 && days <= 30;
}

const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * One row per approved operation not yet invoiced (ADR-0035). It can be invoiced when every completed
 * service is ready; the amount is an estimate before packages and minimums, the invoice values it.
 */
export function groupOperations(services) {
  const groups = new Map();
  for (const service of services) {
    if (service.preinvoiceId) continue;
    const group = groups.get(service.operationId) ?? {
      id: service.operationId, operationCode: service.operationCode, operationDate: service.operationDate,
      airlineId: service.airlineId, airlineName: service.airlineName, flightNumber: service.flightNumber,
      contractCode: service.contractCode, currency: null, services: [], estimate: 0, blockingReason: null,
    };
    group.services.push(service);
    if (service.ready) {
      group.currency ??= service.frozenCurrency;
      group.estimate = round2(group.estimate + (service.amount ?? 0));
    } else if (service.executionStatus === 'Completed' && !group.blockingReason) {
      group.blockingReason = service.blockingReason ?? 'requires_review';
    }
    groups.set(service.operationId, group);
  }
  return [...groups.values()].map(group => ({
    ...group,
    ready: !group.blockingReason && group.services.some(service => service.ready),
    blockingReason: group.blockingReason ?? (group.services.some(service => service.ready) ? null : 'nothing_to_invoice'),
  })).sort((a, b) => a.operationDate.localeCompare(b.operationDate) || a.operationCode.localeCompare(b.operationCode));
}

export function useToInvoiceData(initialStationId) {
  const accountId = useMemo(() => readSession()?.accountId, []);
  const scopes = useMemo(() => (readSession()?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), []);
  const [stationId, setStationId] = useState(
    scopes.some(scope => scope.stationId === initialStationId) ? initialStationId : scopes[0]?.stationId ?? '');
  const today = useMemo(() => localToday(), []);
  const initial = useMemo(() => sundayWeek(today, -1), [today]);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(null);
  const [status, setStatus] = useState('loading');
  const [airline, setAirline] = useState('all');
  const [query, setQuery] = useState('');
  const [pickedIds, setSelectedIds] = useState([]);
  const [issue, setIssue] = useState({ status: 'idle' });
  const attempt = useRef(null);
  const rangeIsValid = validRange(from, to);

  useEffect(() => {
    if (!accountId) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_approved_services')) setRevision(value => value + 1);
    });
    void observer.start().catch(() => {});
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('focus', refresh); void observer.stop(); };
  }, [accountId]);

  useEffect(() => {
    if (!stationId || !rangeIsValid) {
      setStatus(!stationId ? 'forbidden' : 'invalid-range');
      setPage(null);
      return undefined;
    }
    const controller = new AbortController();
    setStatus(current => (current === 'success' ? 'success' : 'loading'));
    getApprovedServices({ stationId, from, to }, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setPage(result);
        setStatus('success');
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setPage(null);
        setStatus(error?.status === 401 ? 'unauthorized' : error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error');
      });
    return () => abortForEffectCleanup(controller);
  }, [stationId, from, to, rangeIsValid, revision]);

  const operations = useMemo(() => groupOperations(page?.services ?? []), [page]);
  // A refresh can invoice or block an operation: only still-ready operations stay selected.
  const selectedIds = useMemo(() => pickedIds.filter(id => operations.some(item => item.id === id && item.ready)),
    [pickedIds, operations]);

  const airlines = useMemo(() => [...new Set(operations.map(item => item.airlineName))].sort(), [operations]);
  const filtered = useMemo(() => operations.filter(item => {
    const normalized = query.trim().toLowerCase();
    const matches = !normalized || [item.operationCode, item.flightNumber ?? '', item.contractCode ?? '']
      .some(value => value.toLowerCase().includes(normalized));
    return matches && (airline === 'all' || item.airlineName === airline);
  }), [operations, query, airline]);
  const selected = useMemo(() => selectedIds.map(id => operations.find(item => item.id === id)).filter(Boolean),
    [selectedIds, operations]);
  const canSelect = item => item.ready && (selectedIds.includes(item.id) || selected.length < MAX_OPERATIONS &&
    (!selected.length || selected[0].airlineId === item.airlineId && selected[0].currency === item.currency));
  const toggle = id => {
    setIssue(current => (current.status === 'issued' ? current : { status: 'idle' }));
    setSelectedIds(current => (current.includes(id) ? current.filter(item => item !== id) : [...selectedIds.filter(item => item !== id), id]));
  };
  const selectAirline = () => {
    const first = selected[0] ?? filtered.find(item => item.ready);
    if (!first) return;
    setSelectedIds(filtered.filter(item => item.ready && item.airlineId === first.airlineId && item.currency === first.currency)
      .slice(0, MAX_OPERATIONS).map(item => item.id));
  };
  const net = round2(selected.reduce((sum, item) => sum + item.estimate, 0));
  const summary = { count: selected.length, airlineName: selected[0]?.airlineName ?? null, currency: selected[0]?.currency ?? null,
    net, tax: round2(net * ITBIS_RATE), total: round2(net * (1 + ITBIS_RATE)) };

  function changeRange(range) {
    setFrom(range.from);
    setTo(range.to);
    setSelectedIds([]);
  }

  async function issueInvoice() {
    if (!selected.length || issue.status === 'issuing') return;
    const operationIds = selectedIds.slice().sort();
    const signature = [stationId, ...operationIds].join('|');
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    setIssue({ status: 'issuing' });
    try {
      const invoice = await issueInvoiceFromOperations({ stationId, operationIds, requestId: attempt.current.requestId });
      attempt.current = null;
      setSelectedIds([]);
      setIssue({ status: 'issued', invoice, airlineName: summary.airlineName });
      setRevision(value => value + 1);
    } catch (error) {
      const stale = error?.status === 409;
      if (stale) attempt.current = null;
      setIssue({ status: 'error', message: invoicingError(error) });
      if (stale || error?.status === 422) setRevision(value => value + 1);
    }
  }

  return {
    status, operations: filtered, totalOperations: operations.length, hasMore: page?.hasMore ?? false,
    scopes, stationId, setStationId: value => { setStationId(value); setSelectedIds([]); },
    from, setFrom: value => changeRange({ from: value, to }), to, setTo: value => changeRange({ from, to: value }),
    setWeek: offset => changeRange(sundayWeek(today, offset)), setMonth: offset => changeRange(calendarMonth(today, offset)),
    airlines, airline, setAirline, query, setQuery,
    selectedIds, canSelect, toggle, selectAirline, clearSelection: () => setSelectedIds([]), summary,
    issue, issueInvoice, dismissIssue: () => setIssue({ status: 'idle' }),
    retry: () => setRevision(value => value + 1),
  };
}
