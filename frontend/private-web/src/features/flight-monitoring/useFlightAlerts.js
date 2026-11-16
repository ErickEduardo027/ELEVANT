import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { flightMonitoringMessages } from './flightMonitoringMessages';

const MAX_VISIBLE_TOASTS = 3;
const TOAST_TTL_MS = 6000;
const ALERT_STATUSES = ['delayed', 'cancelled', 'diverted'];
// The turnaround states of the planning snapshot that end a visit before its time (flightMonitoringService.js).
const TURNAROUND_ALERTS = Object.freeze({ cancelled: 'cancelled', diverted: 'diverted' });

const normalize = value => String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();

/**
 * The priority of each toast of Monitoreo (contratos 2.4, «Prioridad de las alertas»): a flight cancelled or diverted, and
 * the lost connection to the flights' source, ask for attention; a delay, a new estimated time and a lost stand are a
 * plain notice. Nothing here is urgent: an urgent alert is an incident, which the frame announces.
 */
export const FLIGHT_ALERT_PRIORITIES = Object.freeze({
  cancelled: 'attention',
  diverted: 'attention',
  disconnected: 'attention',
  delayed: 'notice',
  etaChanged: 'notice',
  standLost: 'notice',
});

function alertOf(kind, message) {
  return { kind, priority: FLIGHT_ALERT_PRIORITIES[kind], message };
}

function buildAlert(previous, next, t) {
  const values = { flight: next.flightNumber };
  // A leg of the planning snapshot says it through its turnaround; the simulated feed through its own status.
  const state = normalize(next.turnaroundStatus);
  const turnaround = Object.hasOwn(TURNAROUND_ALERTS, state) ? TURNAROUND_ALERTS[state] : null;
  if (turnaround && normalize(previous.turnaroundStatus) !== state) {
    return alertOf(turnaround, t(`alerts.${turnaround}`, values));
  }
  if (previous.status !== next.status && ALERT_STATUSES.includes(next.status)) {
    return alertOf(next.status, t(`alerts.${next.status}`, values));
  }
  if (previous.eta !== next.eta) return alertOf('etaChanged', t('alerts.etaChanged', values));
  if (previous.stand && !next.stand) return alertOf('standLost', t('alerts.standLost', values));
  return null;
}

/**
 * The toasts of Monitoreo de vuelos: what changed in a flight between two reads (cancelled, diverted, delayed, a new
 * estimated time, a lost stand) and the moment the connection to the flights' source is lost. Each toast is
 * `{ id, kind, priority, message, flightNumber? }`, the shape occ-ui/OccToastStack.jsx draws; at most three at a time,
 * each for six seconds. The first read announces nothing: there is nothing to compare it with yet.
 */
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

    enqueueToast(`toast-connection-${idCounterRef.current++}`, alertOf('disconnected', t('alerts.disconnected')));
  }, [connection, t]);

  function dismissToast(id) {
    setToasts(current => current.filter(toast => toast.id !== id));
  }

  return { toasts, dismissToast };
}
