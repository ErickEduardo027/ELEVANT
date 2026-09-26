import { useEffect, useMemo, useState } from 'react';
import { readSession } from '../../auth/authService';
import { getApprovedServices } from '../../../services/approvedServicesService';
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
  const [stationId, setStationId] = useState(scopes[0]?.stationId ?? '');
  const today = useMemo(() => stationToday(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const [from, setFrom] = useState(thirtyDayStart(today));
  const [to, setTo] = useState(today);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(null);
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [airline, setAirline] = useState('all');
  const rangeIsValid = validRange(from, to);

  useEffect(() => {
    if (!accountId) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_approved_services'))
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

  const services = page?.services ?? [];
  const airlines = useMemo(() => [...new Set(services.map(item => item.airlineName))].sort(), [services]);
  const filtered = useMemo(() => services.filter(item => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = !normalized || [item.operationCode, item.flightNumber,
      item.serviceName, item.serviceCode, item.contractCode ?? '']
      .some(value => value.toLowerCase().includes(normalized));
    return matchesQuery && (airline === 'all' || item.airlineName === airline);
  }), [services, query, airline]);

  return {
    status, services: filtered, totalServices: services.length, hasMore: page?.hasMore ?? false,
    scopes, stationId, setStationId, from, setFrom, to, setTo,
    airlines, airline, setAirline, query, setQuery,
    retry: () => setRevision(value => value + 1),
  };
}
