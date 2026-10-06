import { describe, expect, it } from 'vitest';
import { OCC_SHIFT_PRESETS, getOccShiftPreset } from './occShiftPresets';

describe('OCC per-flight shift presets', () => {
  it('contains exactly the six reviewed complete intervals', () => {
    expect(OCC_SHIFT_PRESETS.map(({ startsAtLocal, endsAtLocal }) =>
      `${startsAtLocal}–${endsAtLocal}`)).toEqual([
      '07:00–16:00', '08:00–17:00', '11:00–20:00',
      '12:00–21:00', '15:00–00:00', '23:00–08:00',
    ]);
    expect(OCC_SHIFT_PRESETS.every(item => Object.isFrozen(item))).toBe(true);
    expect(Object.isFrozen(OCC_SHIFT_PRESETS)).toBe(true);
  });

  it('resolves a reviewed choice and rejects an unknown one', () => {
    expect(getOccShiftPreset('night-2300')).toMatchObject({
      startsAtLocal: '23:00', endsAtLocal: '08:00',
    });
    expect(getOccShiftPreset('unknown')).toBeNull();
  });
});
