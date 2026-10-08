import { describe, expect, it } from 'vitest';
import { FINANCE_MODULES, FINANCE_MODULE_IDS, financeNavigation, selectableModules } from './modules';

describe('finance modules', () => {
  it('contains the documented financial workflow without duplicate ids', () => {
    const ids = selectableModules(FINANCE_MODULES).map(module => module.id);
    expect(ids).toEqual([
      FINANCE_MODULE_IDS.HOME,
      FINANCE_MODULE_IDS.CONTRACT_APPROVALS,
      FINANCE_MODULE_IDS.APPROVED_SERVICES,
      FINANCE_MODULE_IDS.PREINVOICES,
      FINANCE_MODULE_IDS.RECONCILIATION,
      FINANCE_MODULE_IDS.TARIFFS,
      FINANCE_MODULE_IDS.CHARGES,
      FINANCE_MODULE_IDS.EXCHANGE_RATES,
      FINANCE_MODULE_IDS.REPORTS,
      FINANCE_MODULE_IDS.USERS,
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps only permitted sub-items and hides an empty group', () => {
    const onlyCharges = financeNavigation(item => item.permission === 'finance.charges.read');
    expect(onlyCharges).toHaveLength(1);
    expect(onlyCharges[0].children.map(child => child.id)).toEqual([FINANCE_MODULE_IDS.CHARGES]);
    expect(financeNavigation(() => false)).toEqual([]);
  });
});
