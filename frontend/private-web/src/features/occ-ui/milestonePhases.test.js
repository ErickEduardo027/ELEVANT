import { FLIGHT_REPORT_MILESTONES, FLIGHT_REPORT_PHASES } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { buildMilestonePhases } from './milestonePhases';

describe('milestonePhases', () => {
  it('builds the four phases of the flight report with totals 6, 13, 4 and 2', () => {
    const phases = buildMilestonePhases([]);
    expect(phases.map(phase => phase.id)).toEqual(FLIGHT_REPORT_PHASES.map(phase => phase.id));
    expect(phases.map(phase => phase.label)).toEqual(['Llegada', 'En posición', 'Salida', 'Retroempuje']);
    expect(phases.map(phase => phase.total)).toEqual([6, 13, 4, 2]);
    expect(phases.reduce((sum, phase) => sum + phase.total, 0)).toBe(FLIGHT_REPORT_MILESTONES.length);
    expect(phases.map(phase => phase.done)).toEqual([0, 0, 0, 0]);
    // Every milestone of the catalogue, in its order, pending, with the tablet's label.
    expect(phases.flatMap(phase => phase.milestones.map(milestone => milestone.code)))
      .toEqual(FLIGHT_REPORT_MILESTONES.map(milestone => milestone.code));
    expect(phases[0].milestones[0]).toEqual({ code: 'BLOCK_ON', label: 'Bloqueo', actualAt: null });
    expect(phases[3].milestones.at(-1)).toEqual({ code: 'PUSHBACK', label: 'Push-back', actualAt: null });
    // In English the phases and the milestones are spelled out; nothing that is not a list still gives four phases.
    const english = buildMilestonePhases(null, 'en');
    expect(english.map(phase => phase.label)).toEqual(['Arrival', 'On stand', 'Departure', 'Pushback']);
    expect(english[0].milestones[0].label).toBe('Block on');
    expect(buildMilestonePhases(undefined).map(phase => phase.done)).toEqual([0, 0, 0, 0]);
  });

  it('counts recorded milestones per phase once each and ignores unknown codes', () => {
    const phases = buildMilestonePhases([
      { code: 'BLOCK_ON', actualAt: '2026-11-14T18:41:00Z' },
      { code: 'WALKAROUND_START', actualAt: '2026-11-14T18:43:00Z' },
      { code: 'WALKAROUND_END', actualAt: '2026-11-14T18:49:00Z' },
      // The same milestone twice counts once, at its first time.
      { code: 'BLOCK_ON', actualAt: '2026-11-14T18:45:00Z' },
      { code: 'FIRST_CUSTOMS', actualAt: '2026-11-14T18:52:00Z' },
      { code: 'PUSHBACK', actualAt: '2026-11-14T19:36:00Z' },
      // Codes the catalogue does not know, and entries without a time, are not milestones of the report.
      { code: 'FUEL', actualAt: '2026-11-14T18:50:00Z' },
      { code: 'block_on', actualAt: '2026-11-14T18:50:00Z' },
      { code: 'BOARDING', actualAt: null },
      { code: 'BULK_CLOSED', actualAt: 'pronto' },
      null,
      { actualAt: '2026-11-14T18:50:00Z' },
    ]);
    expect(phases.map(({ id, done, total }) => [id, done, total])).toEqual([
      ['arrival', 3, 6], ['on_stand', 1, 13], ['departure', 0, 4], ['pushback', 1, 2],
    ]);
    const arrival = phases[0].milestones;
    expect(arrival.find(item => item.code === 'BLOCK_ON').actualAt).toBe('2026-11-14T18:41:00Z');
    expect(arrival.find(item => item.code === 'STAIRS_JETBRIDGE').actualAt).toBeNull();
    expect(phases[2].milestones.find(item => item.code === 'BOARDING').actualAt).toBeNull();
    expect(phases.flatMap(phase => phase.milestones).some(item => item.code === 'FUEL')).toBe(false);
  });
});
