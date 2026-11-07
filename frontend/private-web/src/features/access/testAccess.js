// Every permission code of each department, mirroring DepartmentPermissionCatalog
// in the API. Only tests and previews use it: production reads /governance/me/access.
const codes = (department, modules) => Object.entries(modules)
  .flatMap(([module, actions]) => actions.map(action => `${department}.${module}.${action}`));

export const DepartmentPermissionCodes = {
  operations: codes('operations', {
    dashboard: ['read'], flight_monitoring: ['read'], positions_map: ['read', 'assign'], coverage: ['read', 'assign', 'update'],
    master_data: ['read', 'create', 'update'], devices: ['read', 'unbind', 'revoke'],
    planning: ['read', 'create', 'update', 'assign'], attendance: ['read', 'create'], review: ['read', 'decide'],
    service_closures: ['read', 'create'], reports: ['read', 'export'], notifications: ['read'], chat: ['read', 'create'],
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
  finance: codes('finance', {
    home: ['read'], packages: ['read', 'create', 'update', 'delete', 'publish', 'retire'], contract_approvals: ['read', 'decide'],
    approved_services: ['read', 'create'], preinvoices: ['read', 'update', 'issue'], reconciliation: ['read', 'create'],
    adjustments: ['read', 'create'], tariffs: ['read', 'create', 'update', 'delete', 'publish'],
    charges: ['read', 'create', 'update', 'delete', 'publish'], exchange_rates: ['read', 'create', 'update'],
    billing_units: ['read', 'create', 'update'], receipts: ['read', 'create', 'apply', 'reverse', 'refund'],
    statements: ['read'], suppliers: ['read', 'create', 'update', 'delete'],
    payables: ['read', 'create', 'update', 'approve', 'pay'], expenses: ['read', 'create', 'update', 'approve', 'pay'],
    taxes: ['read', 'create', 'update'], fiscal: ['read', 'create', 'simulate'], reports: ['read', 'export'], notifications: ['read'],
  }),
};
