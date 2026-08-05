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
});
