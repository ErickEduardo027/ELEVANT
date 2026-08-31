import { useEffect, useRef, useState } from 'react';

const MAX_VISIBLE_TOASTS = 3;
const TOAST_TTL_MS = 6000;
const ALERT_LABELS = { delayed: 'retrasado', cancelled: 'cancelado', diverted: 'desviado' };

function buildAlert(previous, next) {
  if (previous.status !== next.status && ALERT_LABELS[next.status]) {
    return { kind: next.status, message: `Vuelo ${next.flightNumber} ${ALERT_LABELS[next.status]}` };
  }
  if (previous.eta !== next.eta) {
    return { kind: 'delayed', message: `Vuelo ${next.flightNumber} cambió su ETA` };
  }
  if (previous.stand && !next.stand) {
    return { kind: 'diverted', message: `Vuelo ${next.flightNumber} sin stand asignado` };
  }
  return null;
}

export function useFlightAlerts(flights, connection) {
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

      const alert = buildAlert(prevFlight, flight);
      if (!alert) return;

      enqueueToast(`toast-${flight.id}-${idCounterRef.current++}`, { flightNumber: flight.flightNumber, ...alert });
    });

    previousRef.current = next;
  }, [flights]);

  useEffect(() => {
    const wasAlreadyDisconnected = previousConnectionRef.current === 'disconnected';
    previousConnectionRef.current = connection;
    if (connection !== 'disconnected' || wasAlreadyDisconnected) return;

    enqueueToast(`toast-connection-${idCounterRef.current++}`, {
      kind: 'error',
      message: 'FlyAware sin conexión — los datos no se están actualizando',
    });
  }, [connection]);

  function dismissToast(id) {
    setToasts(current => current.filter(toast => toast.id !== id));
  }

  return { toasts, dismissToast };
}
