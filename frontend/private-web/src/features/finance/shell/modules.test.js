import { describe, expect, it } from 'vitest';
import { FINANCE_MODULES, FINANCE_MODULE_IDS } from './modules';

describe('finance modules', () => {
  it('contains the documented financial workflow without duplicate ids', () => {
    expect(FINANCE_MODULES.map(module => module.id)).toEqual([
      FINANCE_MODULE_IDS.HOME,
      FINANCE_MODULE_IDS.APPROVED_SERVICES,
      FINANCE_MODULE_IDS.PREINVOICES,
      FINANCE_MODULE_IDS.RECONCILIATION,
      FINANCE_MODULE_IDS.TARIFFS,
      FINANCE_MODULE_IDS.REPORTS,
      FINANCE_MODULE_IDS.USERS,
    ]);
    expect(new Set(FINANCE_MODULES.map(module => module.id)).size).toBe(FINANCE_MODULES.length);
  });
});