import { STATUS_COLORS, getStatusMeta } from './statusMeta';
import { formatClockTime, formatUtcClockTime } from '../../lib/clock';

export { formatClockTime, formatUtcClockTime };

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
