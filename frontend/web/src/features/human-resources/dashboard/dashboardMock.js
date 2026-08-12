// Datos mock mínimos para el Dashboard de Gestión Humana. No existe todavía
// un endpoint real: esta forma refleja `HumanResourcesDashboardSnapshot`
// (ver src/types/humanResourcesDashboard.js) para que pueda sustituirse por
// una llamada REST sin tocar componentes ni mappers.
export const HUMAN_RESOURCES_DASHBOARD_MOCK = {
  activeStaffTotal: 148,
  activeStaffByTerminal: {
    terminalA: 64,
    terminalB: 52,
    fbo: 24,
    unassigned: 8,
  },
  staffByShift: {
    morning: 58,
    afternoon: 54,
    night: 36,
  },
  expirations: [
    { id: 'exp-1', agentName: 'María López', kind: 'certification', itemLabel: 'Belt Loader', dueDate: '2026-08-06T00:00:00-04:00' },
    { id: 'exp-2', agentName: 'Luis Tavárez', kind: 'certification', itemLabel: 'GPU (unidad de potencia terrestre)', dueDate: '2026-08-08T00:00:00-04:00' },
    { id: 'exp-3', agentName: 'Juan Pérez', kind: 'permit', itemLabel: 'Carnet aeroportuario', dueDate: '2026-08-17T00:00:00-04:00' },
    { id: 'exp-4', agentName: 'Ana Fermín', kind: 'permit', itemLabel: 'Licencia de conducir en rampa', dueDate: '2026-08-21T00:00:00-04:00' },
    { id: 'exp-5', agentName: 'Carlos Núñez', kind: 'certification', itemLabel: 'Manejo de mercancías peligrosas', dueDate: '2026-08-30T00:00:00-04:00' },
    { id: 'exp-6', agentName: 'Katherine Objío', kind: 'permit', itemLabel: 'Carnet aeroportuario', dueDate: '2026-09-05T00:00:00-04:00' },
  ],
  pendingAccounts: [
    { id: 'acc-1', name: 'Juan Pérez', role: 'Agente de rampa', registeredAt: '2026-08-07T09:00:00-04:00' },
    { id: 'acc-2', name: 'Katherine Objío', role: 'Coordinadora de turno', registeredAt: '2026-08-05T09:00:00-04:00' },
    { id: 'acc-3', name: 'Luis Tavárez', role: 'Agente de rampa', registeredAt: '2026-08-03T09:00:00-04:00' },
  ],
  activity: [
    { id: 'act-1', type: 'account_activated', description: 'Cuenta de agente activada', responsible: 'Camila Reyes', occurredAt: '2026-08-09T09:40:00-04:00' },
    { id: 'act-2', type: 'certification_registered', description: 'Nueva habilitación registrada', responsible: 'R. Fermín', occurredAt: '2026-08-09T08:15:00-04:00' },
    { id: 'act-3', type: 'permit_updated', description: 'Carnet actualizado', responsible: 'Camila Reyes', occurredAt: '2026-08-08T17:05:00-04:00' },
    { id: 'act-4', type: 'account_disabled', description: 'Agente deshabilitado', responsible: 'Camila Reyes', occurredAt: '2026-08-08T14:30:00-04:00' },
    { id: 'act-5', type: 'shift_changed', description: 'Cambio de turno realizado', responsible: 'L. Tavárez', occurredAt: '2026-08-08T10:00:00-04:00' },
    { id: 'act-6', type: 'certification_renewed', description: 'Habilitación renovada', responsible: 'Camila Reyes', occurredAt: '2026-08-07T16:45:00-04:00' },
  ],
  availability: {
    overallCoveragePercent: 82,
    breakdown: {
      available: 40,
      onShift: 86,
      absent: 10,
      unavailable: 6,
      unassigned: 6,
    },
    byTerminal: [
      { terminal: 'Terminal A', coveragePercent: 91 },
      { terminal: 'Terminal B', coveragePercent: 78 },
      { terminal: 'FBO', coveragePercent: 84 },
    ],
  },
};
