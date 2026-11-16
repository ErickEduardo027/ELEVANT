import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HR_DASHBOARD_READ_ONLY_DEMO_MODE,
  isHumanResourcesDashboardReadOnlyDemo,
} from './hrDemoMode';

describe('HR demo mode', () => {
  it('enables only the exact certified public value', () => {
    expect(
      isHumanResourcesDashboardReadOnlyDemo({
        NEXT_PUBLIC_HR_DEMO_MODE: HR_DASHBOARD_READ_ONLY_DEMO_MODE,
      }),
    ).toBe(true);
    expect(isHumanResourcesDashboardReadOnlyDemo({ NEXT_PUBLIC_HR_DEMO_MODE: 'read-only' })).toBe(false);
    expect(isHumanResourcesDashboardReadOnlyDemo({})).toBe(false);
  });

  it('reads the flag through the literal expression Next inlines into browser bundles', () => {
    const source = readFileSync('src/config/hrDemoMode.js', 'utf8');
    expect(source).toContain('process.env.NEXT_PUBLIC_HR_DEMO_MODE');
    expect(source).not.toMatch(/=\s*process\.env\s*[),;]/);
  });
});
