import { STATUS_COLORS, getStatusMeta } from './statusMeta';

function formatTime(date, timeZone) {
  return date.toLocaleTimeString('es-DO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatClockTime(isoString) {
  return formatTime(new Date(isoString));
}

// Used by the Topbar's dual clock: the station clock reads the viewing
// machine's local time (this tool is operated on-site at the station).
export function formatUtcClockTime(isoString) {
  return formatTime(new Date(isoString), 'UTC');
}

export function mapApprovalToStrip(approval) {
  const meta = getStatusMeta('service', approval.status);
  return {
    key: approval.id,
    accentColor: STATUS_COLORS[meta.color],
    primary: `${approval.flightNumber} · ${approval.airlineIata}`,
    secondary: `${approval.station} · ${approval.agent}`,
    meta: formatClockTime(approval.requestedAt),
    status: approval.status,
  };
}

const ALERT_SEVERITY_COLOR = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

export function mapAlertToStrip(alert) {
  const colorKey = ALERT_SEVERITY_COLOR[alert.severity] ?? 'info';
  return {
    key: alert.id,
    accentColor: STATUS_COLORS[colorKey],
    primary: alert.message,
    secondary: null,
    meta: formatClockTime(alert.occurredAt),
  };
}
