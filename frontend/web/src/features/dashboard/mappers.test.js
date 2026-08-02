import { describe, expect, it } from 'vitest';
import { formatClockTime, mapApprovalToStrip, mapAlertToStrip } from './mappers';

describe('formatClockTime', () => {
  it('formats an ISO string as HH:MM', () => {
    expect(formatClockTime('2026-08-01T13:50:00-04:00')).toMatch(/^\d{1,2}:\d{2}/);
  });
});

describe('mapApprovalToStrip', () => {
  it('maps an approval into flight-strip fields', () => {
    const approval = {
      id: 'appr-1',
      flightNumber: 'DM161',
      airlineIata: 'DM',
      station: 'PUJ',
      agent: 'J. Ramírez',
      requestedAt: '2026-08-01T13:50:00-04:00',
      status: 'pendingReview',
    };
    const strip = mapApprovalToStrip(approval);
    expect(strip.key).toBe('appr-1');
    expect(strip.accentColor).toBe('#D9A441');
    expect(strip.primary).toBe('DM161 · DM');
    expect(strip.secondary).toBe('PUJ · J. Ramírez');
    expect(strip.status).toBe('pendingReview');
  });
});

describe('mapAlertToStrip', () => {
  it('maps a critical alert to the danger color', () => {
    const alert = {
      id: 'alert-3',
      severity: 'critical',
      message: 'Vuelo AA904 marcado como desviado por FlyAware',
      occurredAt: '2026-08-01T13:40:00-04:00',
    };
    const strip = mapAlertToStrip(alert);
    expect(strip.key).toBe('alert-3');
    expect(strip.accentColor).toBe('#C4453C');
    expect(strip.primary).toBe(alert.message);
    expect(strip.secondary).toBeNull();
  });
});
