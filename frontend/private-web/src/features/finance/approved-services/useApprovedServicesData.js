import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApprovedServices, markApprovedServiceReviewed } from '../../../services/approvedServicesService';

export function useApprovedServicesData() {
  const [services, setServices] = useState([]);
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [airline, setAirline] = useState('all');
  const [period, setPeriod] = useState('all');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setServices(await getApprovedServices());
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const airlines = useMemo(() => [...new Set(services.map(item => item.airline))].sort(), [services]);
  const filtered = useMemo(() => services.filter(item => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery = !normalized || [item.id, item.airline, item.flight, item.service, item.contract].some(value => value.toLowerCase().includes(normalized));
    const matchesAirline = airline === 'all' || item.airline === airline;
    const matchesPeriod = period === 'all' || item.date.startsWith(period);
    return matchesQuery && matchesAirline && matchesPeriod;
  }), [services, query, airline, period]);

  async function markReviewed(id) {
    await markApprovedServiceReviewed(id);
    await load();
  }

  return { status, services: filtered, airlines, query, setQuery, airline, setAirline, period, setPeriod, markReviewed, retry: load };
}
