import { describe, expect, it } from 'vitest';
import {
  HR_DASHBOARD_READ_ONLY_DEMO_MODE,
  isHumanResourcesDashboardReadOnlyDemo,
} from './hrDemoMode';

describe('HR demo mode', () => {
  it('enables only the exact certified public value', () => {
    expect(
      isHumanResourcesDashboardReadOnlyDemo({
        VITE_HR_DEMO_MODE: HR_DASHBOARD_READ_ONLY_DEMO_MODE,
      }),
    ).toBe(true);
    expect(isHumanResourcesDashboardReadOnlyDemo({ VITE_HR_DEMO_MODE: 'read-only' })).toBe(false);
    expect(isHumanResourcesDashboardReadOnlyDemo({})).toBe(false);
  });
});
