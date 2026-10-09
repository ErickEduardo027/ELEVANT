// Every permission code of each department, mirroring DepartmentPermissionCatalog
// in the API. Only tests and previews use it: production reads /governance/me/access.
const codes = (department, modules) => Object.entries(modules)
  .flatMap(([module, actions]) => actions.map(action => `${department}.${module}.${action}`));

export const DepartmentPermissionCodes = {
  operations: codes('operations', {
    dashboard: ['read'], planning: ['read', 'manage', 'assign'], flight_monitoring: ['read'], positions_map: ['read'],
    attendance: ['read', 'record'], review: ['read', 'decide'], reports: ['read', 'export'], notifications: ['read'],
    chat: ['read', 'send'], service_closures: ['read', 'request'],
  }),
  humanResources: codes('human_resources', {
    dashboard: ['read'], employees: ['read', 'manage', 'terminate'], positions: ['read', 'manage'],
    requisitions: ['read', 'attend'], ramp_profiles: ['read', 'manage'], qualifications: ['read', 'manage'], permits: ['read', 'manage'],
    schedules: ['read', 'manage'], availability: ['read', 'decide'], attendance: ['read', 'validate'],
    reports: ['read', 'export'], audit: ['read'], notifications: ['read'], access_requests: ['read', 'validate'],
  }),
  contracts: codes('contracts', {
    home: ['read'], agreements: ['read'], drafts: ['read', 'edit', 'activate'],
    requests: ['read', 'verify', 'approve', 'reject'], catalog: ['read', 'create', 'edit', 'retire'],
    service_closures: ['read', 'decide', 'reopen'], reports: ['read'],
  }),
  finance: codes('finance', {
    home: ['read'], approved_services: ['read', 'preinvoice'], preinvoices: ['read', 'manage'],
    reconciliation: ['read', 'record'], tariffs: ['read', 'manage'], charges: ['read', 'manage'],
    exchange_rates: ['read', 'manage'], contract_approvals: ['read', 'decide'], reports: ['read', 'export'],
  }),
};
