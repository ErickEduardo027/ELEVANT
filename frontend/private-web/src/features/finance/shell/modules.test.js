import { describe, expect, it } from 'vitest';
import { FINANCE_MODULES, FINANCE_MODULE_IDS, financeNavigation, selectableModules } from './modules';

describe('finance modules', () => {
  it('is the simplified menu: Inicio · Facturación · Cuentas por pagar · Reportes · Configuración · Usuarios (4-A)', () => {
    expect(FINANCE_MODULES.map(module => module.id)).toEqual([
      FINANCE_MODULE_IDS.HOME,
      FINANCE_MODULE_IDS.INVOICING,
      FINANCE_MODULE_IDS.PAYABLES_GROUP,
      FINANCE_MODULE_IDS.REPORTS,
      FINANCE_MODULE_IDS.CONFIGURATION,
      FINANCE_MODULE_IDS.USERS,
    ]);
    expect(FINANCE_MODULES.map(module => module.label)).toEqual([
      'Inicio', 'Facturación', 'Cuentas por pagar', 'Reportes', 'Configuración', 'Usuarios del departamento',
    ]);
    const group = id => FINANCE_MODULES.find(module => module.id === id).children.map(child => child.label);
    expect(group(FINANCE_MODULE_IDS.INVOICING)).toEqual(['Por facturar', 'Facturas', 'Charters']);
    expect(group(FINANCE_MODULE_IDS.PAYABLES_GROUP)).toEqual(['Facturas de proveedores', 'Proveedores', 'Gastos de empleados', 'Mis gastos']);
    expect(group(FINANCE_MODULE_IDS.CONFIGURATION)).toEqual(['Tarifario de servicios', 'Tarifario de cargos', 'Paquetes',
      'Reglas de cierre', 'Aprobación de contratos', 'Tasas de cambio', 'Unidades de cobro']);
  });

  it('lists every selectable module once and none of the retired ones', () => {
    const modules = selectableModules(FINANCE_MODULES);
    const ids = modules.map(module => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const retired of ['finance-preinvoices', 'finance-approved-services', 'finance-taxes', 'finance-fiscal',
      'finance-treasury', 'finance-statements', 'finance-tariff-books'])
      expect(ids).not.toContain(retired);
    const permissions = modules.map(module => module.permission).filter(Boolean);
    expect(permissions.filter(code => /\.(preinvoices|approved_services|taxes|fiscal)\./.test(code))).toEqual([]);
    expect(permissions).not.toContain('finance.receipts.read');
    expect(permissions).not.toContain('finance.statements.read');
  });

  it('keeps only permitted sub-items and hides an empty group', () => {
    const onlyCharges = financeNavigation(item => item.permission === 'finance.charges.read');
    expect(onlyCharges).toHaveLength(1);
    expect(onlyCharges[0].id).toBe(FINANCE_MODULE_IDS.CONFIGURATION);
    expect(onlyCharges[0].children.map(child => child.id)).toEqual([FINANCE_MODULE_IDS.CHARGES]);
    const invoicing = financeNavigation(item => ['finance.home.read', 'finance.invoicing.read'].includes(item.permission));
    expect(invoicing.map(module => module.id)).toEqual([FINANCE_MODULE_IDS.HOME, FINANCE_MODULE_IDS.INVOICING]);
    expect(invoicing[1].children.map(child => child.id)).toEqual([FINANCE_MODULE_IDS.TO_INVOICE]);
    expect(financeNavigation(() => false)).toEqual([]);
  });

  it('offers «Mis gastos» to every Finance member, without a Finance code (4-N28)', () => {
    const own = FINANCE_MODULES.find(module => module.id === FINANCE_MODULE_IDS.PAYABLES_GROUP).children
      .find(child => child.id === FINANCE_MODULE_IDS.OWN_EXPENSES);
    expect(own).toEqual({ id: FINANCE_MODULE_IDS.OWN_EXPENSES, label: 'Mis gastos' });
    const member = financeNavigation(item => !item.permission && !item.administratorsOnly);
    expect(member.map(module => module.id)).toEqual([FINANCE_MODULE_IDS.PAYABLES_GROUP]);
    expect(member[0].children.map(child => child.label)).toEqual(['Mis gastos']);
    const permissions = selectableModules(FINANCE_MODULES).map(module => module.permission).filter(Boolean);
    expect(permissions).not.toContain('finance.expenses.create');
    expect(permissions).not.toContain('finance.expenses.update');
  });

  it("no longer manages the commercial catalog: Contracts owns it", () => {
    const labels = selectableModules(FINANCE_MODULES).map(module => module.label);
    expect(labels).not.toContain("Catálogo comercial");
    expect(labels).toContain("Unidades de cobro");
  });
});
