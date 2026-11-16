import { describe, expect, it } from 'vitest';
import { getPlanningStatusMeta } from './planningStatus';

describe('getPlanningStatusMeta', () => {
  it.each([
    ['Confirmed', { label: 'Confirmada', color: 'info' }],
    ['in-progress', { label: 'En operación', color: 'active' }],
    ['COMPLETED', { label: 'Completada', color: 'success' }],
    ['Delayed', { label: 'Retrasada', color: 'warning' }],
    ['cancelled', { label: 'Cancelada', color: 'danger' }],
  ])('maps %s to the shared operational vocabulary', (status, expected) => {
    expect(getPlanningStatusMeta(status)).toEqual(expected);
  });

  it('humanizes unknown values without inventing a status meaning', () => {
    expect(getPlanningStatusMeta('Awaiting_Aircraft')).toEqual({
      label: 'Awaiting Aircraft',
      color: 'info',
    });
    expect(getPlanningStatusMeta(null)).toEqual({ label: 'Sin estado', color: 'info' });
  });
});