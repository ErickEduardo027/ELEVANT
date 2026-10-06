import { describe, expect, it } from 'vitest';
import { STATUS_COLORS, getStatusMeta } from './statusMeta';

describe('getStatusMeta', () => {
  it('maps known flight statuses to label and color', () => {
    expect(getStatusMeta('flight', 'scheduled')).toEqual({ label: 'Programado', color: 'info' });
    expect(getStatusMeta('flight', 'delayed')).toEqual({ label: 'Retrasado', color: 'warning' });
    expect(getStatusMeta('flight', 'cancelled')).toEqual({ label: 'Cancelado', color: 'danger' });
  });

  it('maps the Planning-module flight statuses to label and color', () => {
    expect(getStatusMeta('flight', 'boarding')).toEqual({ label: 'Abordando', color: 'active' });
    expect(getStatusMeta('flight', 'taxiing')).toEqual({ label: 'Rodaje', color: 'active' });
    expect(getStatusMeta('flight', 'arrived')).toEqual({ label: 'En posición', color: 'success' });
  });

  it('maps known service statuses to label and color', () => {
    expect(getStatusMeta('service', 'pendingReview')).toEqual({
      label: 'Pendiente de revisión',
      color: 'warning',
    });
  });

  it('falls back to the raw status string for unknown statuses', () => {
    expect(getStatusMeta('flight', 'mystery')).toEqual({ label: 'mystery', color: 'info' });
  });

  it('exposes all five status colors as hex strings', () => {
    expect(STATUS_COLORS).toEqual({
      info: '#145DC4',
      active: '#F2661E',
      success: '#1E9E6B',
      warning: '#D9A441',
      danger: '#C4453C',
    });
  });

  it('maps the Flight Monitoring statuses to label and color', () => {
    expect(getStatusMeta('flight', 'leftGate')).toEqual({ label: 'Salió de puerta', color: 'active' });
    expect(getStatusMeta('flight', 'approaching')).toEqual({ label: 'Aproximando', color: 'active' });
    expect(getStatusMeta('flight', 'taxiingToGate')).toEqual({ label: 'Rodaje a puerta', color: 'active' });
    expect(getStatusMeta('flight', 'unknown')).toEqual({ label: 'Desconocido', color: 'info' });
  });

  it('maps the Review-module statuses to label and color', () => {
    expect(getStatusMeta('review', 'PENDING_REVIEW')).toEqual({ label: 'Pendiente de revisión', color: 'warning' });
    expect(getStatusMeta('review', 'IN_REVIEW')).toEqual({ label: 'En revisión', color: 'info' });
    expect(getStatusMeta('review', 'APPROVED')).toEqual({ label: 'Aprobado', color: 'success' });
    expect(getStatusMeta('review', 'RETURNED')).toEqual({ label: 'Devuelto con correcciones', color: 'danger' });
    expect(getStatusMeta('review', 'RESUBMITTED')).toEqual({ label: 'Reenviado', color: 'info' });
  });

  it('maps the Reports-module domains to label and color', () => {
    expect(getStatusMeta('closure', 'normal')).toEqual({ label: 'Margen suficiente', color: 'success' });
    expect(getStatusMeta('closure', 'warning')).toEqual({ label: 'Margen ajustado', color: 'warning' });
    expect(getStatusMeta('closure', 'critical')).toEqual({ label: 'Situación crítica', color: 'danger' });
    expect(getStatusMeta('groundTime', 'within_sla')).toEqual({ label: 'Dentro del SLA', color: 'success' });
    expect(getStatusMeta('groundTime', 'near_limit')).toEqual({ label: 'Cerca del límite', color: 'warning' });
    expect(getStatusMeta('groundTime', 'exceeded')).toEqual({ label: 'Excedido', color: 'danger' });
    expect(getStatusMeta('reconciliation', 'conforme')).toEqual({ label: 'Conforme', color: 'success' });
    expect(getStatusMeta('reconciliation', 'diferencia')).toEqual({ label: 'Diferencia', color: 'warning' });
    expect(getStatusMeta('reconciliation', 'no_ejecutado')).toEqual({ label: 'No ejecutado', color: 'danger' });
  });

  it('maps the Notifications-module severities to label and color', () => {
    expect(getStatusMeta('notification', 'info')).toEqual({ label: 'Informativa', color: 'info' });
    expect(getStatusMeta('notification', 'warning')).toEqual({ label: 'Atención', color: 'warning' });
    expect(getStatusMeta('notification', 'critical')).toEqual({ label: 'Crítica', color: 'danger' });
    expect(getStatusMeta('notification', 'success')).toEqual({ label: 'Positiva', color: 'success' });
  });

  it('maps the Chat interno conversation statuses to label and color', () => {
    expect(getStatusMeta('chat', 'active')).toEqual({ label: 'En curso', color: 'active' });
    expect(getStatusMeta('chat', 'pending')).toEqual({ label: 'Pendiente', color: 'warning' });
    expect(getStatusMeta('chat', 'closed')).toEqual({ label: 'Cerrada', color: 'success' });
  });

  it('maps the Mapa de posiciones statuses to label and color', () => {
    expect(getStatusMeta('position', 'available')).toEqual({ label: 'Libre', color: 'success' });
    expect(getStatusMeta('position', 'occupied')).toEqual({ label: 'Ocupada', color: 'info' });
    expect(getStatusMeta('position', 'disabled')).toEqual({ label: 'Inhabilitada', color: 'danger' });
    expect(getStatusMeta('position', 'releasing')).toEqual({ label: 'Próxima a liberarse', color: 'warning' });
  });
});