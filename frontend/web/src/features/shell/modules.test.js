import { describe, expect, it } from 'vitest';
import { MODULES, MODULE_IDS } from './modules';

describe('MODULES', () => {
  it('lists the 8 admin/OCC modules with Dashboard first', () => {
    expect(MODULES).toHaveLength(8);
    expect(MODULES[0].id).toBe(MODULE_IDS.DASHBOARD);
  });

  it('gives every module a unique id, label, icon, and description', () => {
    const ids = MODULES.map(module => module.id);
    expect(new Set(ids).size).toBe(MODULES.length);
    MODULES.forEach(module => {
      expect(module.label).toEqual(expect.any(String));
      expect(module.icon).toEqual(expect.any(Function));
      expect(module.description.length).toBeGreaterThan(10);
    });
  });
});
