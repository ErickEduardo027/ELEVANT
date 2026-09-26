import { useEffect, useMemo, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import { getApprovedServices, createPreinvoiceDraft, getPreinvoiceDraft } from '../../../services/approvedServicesService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';

function stationToday(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function thirtyDayStart(today) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 30);
  return date.toISOString().slice(0, 10);
}

function validRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return days >= 0 && days <= 30;
}

export function useApprovedServicesData() {
  const accountId = useMemo(() => readSession()?.accountId, []);
  const scopes = useMemo(() => (readSession()?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), []);
  const [stationId, setStationIdState] = useState(scopes[0]?.stationId ?? '');
  const today = useMemo(() => stationToday(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const [from, setFromState] = useState(thirtyDayStart(today));
  const [to, setToState] = useState(today);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(null);
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [airline, setAirline] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [draftStatus, setDraftStatus] = useState('idle');
  const [draftId, setDraftId] = useState(null);
  const [draftDetail, setDraftDetail] = useState(null);
  const draftRequest = useRef(null);
  const contextGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const rangeIsValid = validRange(from, to);

  function changeContext(setter, value) {
    contextGeneration.current += 1;
    detailGeneration.current += 1;
    setter(value);
  }

  useEffect(() => {
    if (!accountId) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_approved_services') || resources.includes('finance_preinvoices'))
        setRevision(value => value + 1);
    });
    void observer.start();
    const onFocus = () => setRevision(value => value + 1);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') onFocus();
    }, 25_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      void observer.stop();
    };
  }, [accountId]);

  useEffect(() => {
    if (!stationId || !rangeIsValid) {
      setStatus(!stationId ? 'forbidden' : 'invalid-range');
      setPage(null);
      return undefined;
    }
    const controller = new AbortController();
    setStatus('loading');
    getApprovedServices({ stationId, from, to }, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setSelectedIds(current => current.filter(id => result.services.some(item =>
          item.id === id && item.ready && !item.preinvoiceId)));
        setPage(result);
        setStatus('success');
      })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setPage(null);
        setStatus(error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error');
      });
    return () => controller.abort();
  }, [stationId, from, to, rangeIsValid, revision]);

  useEffect(() => {
    setSelectedIds([]);
    setDraftStatus('idle');
    setDraftId(null);
    setDraftDetail(null);
    draftRequest.current = null;
  }, [stationId, from, to]);

  const services = page?.services ?? [];
  const airlines = useMemo(() => [...new Set(services.map(item => item.airlineName))].sort(), [services]);
  const filtered = useMemo(() => services.filter(item => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = !normalized || [item.operationCode, item.flightNumber,
      item.serviceName, item.serviceCode, item.contractCode ?? '']
      .some(value => value.toLowerCase().includes(normalized));
    return matchesQuery && (airline === 'all' || item.airlineName === airline);
  }), [services, query, airline]);
  const selected = useMemo(() => selectedIds
    .map(id => services.find(item => item.id === id))
    .filter(Boolean), [selectedIds, services]);
  const canSelect = item => item.ready && !item.preinvoiceId &&
    (selectedIds.includes(item.id) || selected.length < 100 &&
      (!selected.length || selected[0].airlineId === item.airlineId &&
        selected[0].frozenCurrency === item.frozenCurrency));
  const toggleSelection = id => setSelectedIds(current =>
    current.includes(id) ? current.filter(item => item !== id) : [...current, id]);

  async function openDraft(id) {
    const context = contextGeneration.current;
    const requestVersion = ++detailGeneration.current;
    setDraftId(id);
    setDraftDetail(null);
    setDraftStatus('loading-detail');
    try {
      const detail = await getPreinvoiceDraft(id, stationId);
      if (context !== contextGeneration.current || requestVersion !== detailGeneration.current) return;
      setDraftDetail(detail);
      setDraftStatus('saved');
    } catch {
      if (context !== contextGeneration.current || requestVersion !== detailGeneration.current) return;
      setDraftStatus('detail-error');
    }
  }

  async function createDraft() {
    if (!selected.length || draftStatus === 'creating') return;
    const context = contextGeneration.current;
    const requestVersion = ++detailGeneration.current;
    const signature = [stationId, from, to, ...selectedIds.slice().sort()].join('|');
    if (draftRequest.current?.signature !== signature)
      draftRequest.current = { signature, requestId: crypto.randomUUID() };
    setDraftStatus('creating');
    try {
      const created = await createPreinvoiceDraft({ stationId, from, to,
        requestId: draftRequest.current.requestId, serviceIds: selectedIds });
      setRevision(value => value + 1);
      if (context !== contextGeneration.current || requestVersion !== detailGeneration.current) return;
      setSelectedIds([]);
      setDraftId(created.id);
      setDraftStatus('saved');
      await openDraft(created.id);
    } catch (error) {
      if (context !== contextGeneration.current || requestVersion !== detailGeneration.current) return;
      setDraftStatus(error?.status === 409 ? 'conflict' : 'error');
      if (error?.status === 409) setRevision(value => value + 1);
    }
  }

  return {
    status, services: filtered, totalServices: services.length, hasMore: page?.hasMore ?? false,
    scopes, stationId, setStationId: value => changeContext(setStationIdState, value),
    from, setFrom: value => changeContext(setFromState, value),
    to, setTo: value => changeContext(setToState, value),
    airlines, airline, setAirline, query, setQuery,
    selectedIds, selectedCount: selected.length, canSelect, toggleSelection,
    createDraft, openDraft, draftStatus, draftId, draftDetail,
    retry: () => setRevision(value => value + 1),
  };
}
