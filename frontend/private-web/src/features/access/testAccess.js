// Every permission code of each department, mirroring DepartmentPermissionCatalog
// in the API. Only tests and previews use it: production reads /governance/me/access.
const codes = (department, modules) => Object.entries(modules)
  .flatMap(([module, actions]) => actions.map(action => `${department}.${module}.${action}`));

export const DepartmentPermissionCodes = {
  operations: codes('operations', {
    dashboard: ['read'], flight_monitoring: ['read'], positions_map: ['read', 'assign'], coverage: ['read', 'assign', 'update'],
    master_data: ['read', 'create', 'update'], devices: ['read', 'unbind', 'revoke'],
    planning: ['read', 'create', 'update', 'assign'], attendance: ['read', 'create'], review: ['read', 'decide', 'reopen'],
    incidents: ['read', 'update'], service_closures: ['read', 'create'], reports: ['read', 'export'],
    notifications: ['read'], chat: ['read', 'create'],
  }),
  humanResources: codes('human_resources', {
    dashboard: ['read'], employees: ['read', 'create', 'update', 'delete'], positions: ['read', 'create', 'update'],
    requisitions: ['read', 'attend'], ramp_profiles: ['read', 'update'], qualifications: ['read', 'create', 'update'],
    permits: ['read', 'create', 'update'], schedules: ['read'], availability: ['read', 'create', 'decide'],
    attendance: ['read', 'validate'], reports: ['read', 'export'], audit: ['read'], notifications: ['read'],
    access_requests: ['read', 'validate'],
  }),
  contracts: codes('contracts', {
    home: ['read'], agreements: ['read', 'sign'], agreed_services: ['read'], drafts: ['read', 'update', 'activate'],
    requests: ['read', 'verify', 'approve', 'reject'], catalog: ['read', 'create', 'update', 'delete'],
    service_closures: ['read', 'decide', 'reopen'], reports: ['read'], notifications: ['read'],
  }),
  // 4-A: the simplified Finance (ADR-0035, block 3) has no preinvoices, approved services, tax treatments or fiscal
  // documents; «Cobros» and «Estados de cuenta» are tabs of «Facturas».
  finance: codes('finance', {
    home: ['read'], notifications: ['read'], invoicing: ['read', 'issue'], reconciliation: ['read'],
    adjustments: ['read', 'create'], receipts: ['read', 'create', 'apply', 'reverse', 'refund'], statements: ['read'],
    charters: ['read', 'confirm'], payables: ['read', 'create', 'update', 'approve', 'pay', 'reverse'],
    suppliers: ['read', 'create', 'update', 'delete'], expenses: ['read', 'approve', 'pay'],
    reports: ['read', 'export'], tariffs: ['read', 'create', 'update', 'delete', 'publish'],
    charges: ['read', 'create', 'update', 'delete', 'publish'],
    packages: ['read', 'create', 'update', 'delete', 'publish', 'retire'], close_rules: ['read', 'update'],
    contract_approvals: ['read', 'decide'], exchange_rates: ['read', 'create', 'update'],
    billing_units: ['read', 'create', 'update'],
  }),
};
