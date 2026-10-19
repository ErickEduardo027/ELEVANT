import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { flightMonitoringMessages } from './flightMonitoringMessages';

const MAX_VISIBLE_TOASTS = 3;
const TOAST_TTL_MS = 6000;
const ALERT_STATUSES = ['delayed', 'cancelled', 'diverted'];

function buildAlert(previous, next, t) {
  const values = { flight: next.flightNumber };
  if (previous.status !== next.status && ALERT_STATUSES.includes(next.status)) {
    return { kind: next.status, message: t(`alerts.${next.status}`, values) };
  }
  if (previous.eta !== next.eta) {
    return { kind: 'delayed', message: t('alerts.etaChanged', values) };
  }
  if (previous.stand && !next.stand) {
    return { kind: 'diverted', message: t('alerts.standLost', values) };
  }
  return null;
}

export function useFlightAlerts(flights, connection) {
  const { t } = useTranslation(flightMonitoringMessages);
  const previousRef = useRef(new Map());
  const idCounterRef = useRef(0);
  const mountedRef = useRef(true);
  const previousConnectionRef = useRef(connection);
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function enqueueToast(id, toast) {
    setToasts(current => [...current, { id, ...toast }].slice(-MAX_VISIBLE_TOASTS));
    setTimeout(() => {
      if (mountedRef.current) setToasts(current => current.filter(existing => existing.id !== id));
    }, TOAST_TTL_MS);
  }

  useEffect(() => {
    const previous = previousRef.current;
    const next = new Map();

    flights.forEach(flight => {
      next.set(flight.id, flight);
      const prevFlight = previous.get(flight.id);
      if (!prevFlight) return;

      const alert = buildAlert(prevFlight, flight, t);
      if (!alert) return;

      enqueueToast(`toast-${flight.id}-${idCounterRef.current++}`, { flightNumber: flight.flightNumber, ...alert });
    });

    previousRef.current = next;
  }, [flights, t]);

  useEffect(() => {
    const wasAlreadyDisconnected = previousConnectionRef.current === 'disconnected';
    previousConnectionRef.current = connection;
    if (connection !== 'disconnected' || wasAlreadyDisconnected) return;

    enqueueToast(`toast-connection-${idCounterRef.current++}`, {
      kind: 'error',
      message: t('alerts.disconnected'),
    });
  }, [connection, t]);

  function dismissToast(id) {
    setToasts(current => current.filter(toast => toast.id !== id));
  }

  return { toasts, dismissToast };
}
