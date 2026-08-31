const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

function getStationDate(daysAgo = 0) {
  const date = new Date(Date.now() - STATION_UTC_OFFSET_MS - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function isoAt(dateISO, hour, minute) {
  return `${dateISO}T${pad(hour)}:${pad(minute)}:00-04:00`;
}

function ctx(items) {
  return items;
}

function detail(fields, metadata = {}) {
  return { detailFields: fields, metadata };
}

const today = getStationDate(0);
const yesterday = getStationDate(1);
const thisWeek = getStationDate(3);
const older = getStationDate(12);

export const HUMAN_RESOURCES_NOTIFICATIONS_MOCK = [
  {
    id: 'HRN-3001',
    category: 'expirations',
    severity: 'critical',
    title: 'Carnet vencido de Yeimy Santana',
    description: 'El carnet aeroportuario de Yeimy Santana venció y requiere renovación inmediata.',
    read: false,
    createdAt: isoAt(today, 8, 12),
    subjectName: 'Yeimy Santana',
    reference: 'CARN-2025-0991',
    relatedModule: 'permits',
    relatedRoute: 'u-14',
    source: 'Gestión Humana',
    contextItems: ctx([
      { label: 'Agente', value: 'Yeimy Santana' },
      { label: 'Documento', value: 'Carnet aeroportuario' },
    ]),
    ...detail(
      [
        { label: 'Agente', value: 'Yeimy Santana' },
        { label: 'Documento', value: 'Carnet aeroportuario' },
        { label: 'Referencia', value: 'CARN-2025-0991' },
        { label: 'Estado', value: 'Vencido' },
      ],
      { agentId: 'u-14', daysOverdue: 3, documentType: 'carnet' }
    ),
  },
  {
    id: 'HRN-3002',
    category: 'expirations',
    severity: 'warning',
    title: 'Habilitación de Kevin Díaz próxima a vencer',
    description: 'La habilitación de puente de abordaje vence en 5 días.',
    read: false,
    createdAt: isoAt(today, 9, 26),
    subjectName: 'Kevin Alexander Díaz',
    reference: 'Q-10 / Bridge',
    relatedModule: 'certifications',
    relatedRoute: 'u-11',
    source: 'Gestión Humana',
    contextItems: ctx([
      { label: 'Agente', value: 'Kevin Alexander Díaz' },
      { label: 'Equipo', value: 'Puente de abordaje' },
    ]),
    ...detail(
      [
        { label: 'Agente', value: 'Kevin Alexander Díaz' },
        { label: 'Equipo', value: 'Puente de abordaje' },
        { label: 'Referencia', value: 'Q-10' },
        { label: 'Días restantes', value: '5' },
      ],
      { agentId: 'u-11', equipmentId: 'bridge', daysRemaining: 5 }
    ),
  },
  {
    id: 'HRN-3003',
    category: 'accounts',
    severity: 'warning',
    title: 'Cuenta pendiente de activar',
    description: 'La cuenta de Julio César Mena aún no fue activada por el equipo de Gestión Humana.',
    read: false,
    createdAt: isoAt(today, 10, 8),
    subjectName: 'Julio César Mena',
    reference: 'u-7',
    relatedModule: 'users',
    relatedRoute: 'u-7',
    source: 'Usuarios',
    contextItems: ctx([
      { label: 'Usuario', value: 'Julio César Mena' },
      { label: 'Estado', value: 'Pendiente' },
    ]),
    ...detail(
      [
        { label: 'Usuario', value: 'Julio César Mena' },
        { label: 'Correo', value: 'julio.mena@elevant.com' },
        { label: 'Estado', value: 'Pendiente de activación' },
      ],
      { userId: 'u-7', role: 'Analista de Finanzas' }
    ),
  },
  {
    id: 'HRN-3004',
    category: 'accounts',
    severity: 'critical',
    title: 'Cuenta desactivada por seguridad',
    description: 'La cuenta de Marco Antonio Silva fue desactivada tras cierre de contrato.',
    read: true,
    createdAt: isoAt(yesterday, 14, 18),
    subjectName: 'Marco Antonio Silva',
    reference: 'u-17',
    relatedModule: 'users',
    relatedRoute: 'u-17',
    source: 'Usuarios',
    contextItems: ctx([
      { label: 'Usuario', value: 'Marco Antonio Silva' },
      { label: 'Estado', value: 'Desactivada' },
    ]),
    ...detail(
      [
        { label: 'Usuario', value: 'Marco Antonio Silva' },
        { label: 'Correo', value: 'marco.silva@latam.com' },
        { label: 'Motivo', value: 'Fin de contrato con la aerolínea' },
      ],
      { userId: 'u-17', accountStatus: 'disabled' }
    ),
  },
  {
    id: 'HRN-3005',
    category: 'coverage',
    severity: 'critical',
    title: 'Cobertura insuficiente en Terminal B',
    description: 'El turno de madrugada quedó con dos posiciones sin cubrir en Terminal B.',
    read: false,
    createdAt: isoAt(yesterday, 7, 45),
    subjectName: 'Cobertura operativa',
    reference: 'SHIFT-GAP-08',
    relatedModule: 'schedules',
    relatedRoute: null,
    source: 'Horarios',
    contextItems: ctx([
      { label: 'Terminal', value: 'B' },
      { label: 'Turno', value: 'Madrugada' },
    ]),
    ...detail(
      [
        { label: 'Terminal', value: 'B' },
        { label: 'Turno', value: 'Madrugada' },
        { label: 'Cobertura', value: 'Parcial' },
        { label: 'Referencia', value: 'SHIFT-GAP-08' },
      ],
      { terminal: 'B', shiftBlock: 'night', missingPositions: 2 }
    ),
  },
  {
    id: 'HRN-3006',
    category: 'coverage',
    severity: 'info',
    title: 'Cobertura ajustada en Terminal A',
    description: 'Se reasignó un agente para cubrir la posición pendiente en Terminal A.',
    read: true,
    createdAt: isoAt(yesterday, 11, 25),
    subjectName: 'Terminal A',
    reference: 'SHIFT-OK-14',
    relatedModule: 'schedules',
    relatedRoute: null,
    source: 'Horarios',
    contextItems: ctx([
      { label: 'Terminal', value: 'A' },
      { label: 'Estado', value: 'Cubierta' },
    ]),
    ...detail(
      [
        { label: 'Terminal', value: 'A' },
        { label: 'Turno', value: 'Mañana' },
        { label: 'Estado', value: 'Cubierta' },
        { label: 'Referencia', value: 'SHIFT-OK-14' },
      ],
      { terminal: 'A', shiftBlock: 'morning' }
    ),
  },
  {
    id: 'HRN-3007',
    category: 'confirmations',
    severity: 'success',
    title: 'Renovación de licencia confirmada',
    description: 'La licencia de conducir en rampa de Kevin Alexander Díaz quedó renovada correctamente.',
    read: true,
    createdAt: isoAt(thisWeek, 12, 10),
    subjectName: 'Kevin Alexander Díaz',
    reference: 'LIC-RAMP-0311',
    relatedModule: 'permits',
    relatedRoute: 'u-11',
    source: 'Permisos',
    contextItems: ctx([
      { label: 'Agente', value: 'Kevin Alexander Díaz' },
      { label: 'Documento', value: 'Licencia' },
    ]),
    ...detail(
      [
        { label: 'Agente', value: 'Kevin Alexander Díaz' },
        { label: 'Documento', value: 'Licencia de conducir en rampa' },
        { label: 'Referencia', value: 'LIC-RAMP-0311' },
        { label: 'Estado', value: 'Renovada' },
      ],
      { agentId: 'u-11', permitType: 'licencia' }
    ),
  },
  {
    id: 'HRN-3008',
    category: 'confirmations',
    severity: 'success',
    title: 'Cambio de rol confirmado',
    description: 'El nuevo rol de Julio César Mena quedó confirmado en el módulo de usuarios.',
    read: false,
    createdAt: isoAt(thisWeek, 9, 30),
    subjectName: 'Julio César Mena',
    reference: 'ROLE-CHANGE-07',
    relatedModule: 'users',
    relatedRoute: 'u-7',
    source: 'Usuarios',
    contextItems: ctx([
      { label: 'Usuario', value: 'Julio César Mena' },
      { label: 'Rol', value: 'Generalista de Gestión Humana' },
    ]),
    ...detail(
      [
        { label: 'Usuario', value: 'Julio César Mena' },
        { label: 'Rol anterior', value: 'Analista de Finanzas' },
        { label: 'Rol nuevo', value: 'Generalista de Gestión Humana' },
        { label: 'Referencia', value: 'ROLE-CHANGE-07' },
      ],
      { userId: 'u-7', previousRole: 'Analista de Finanzas', nextRole: 'Generalista de Gestión Humana' }
    ),
  },
  {
    id: 'HRN-3009',
    category: 'confirmations',
    severity: 'info',
    title: 'Exportación completada',
    description: 'El reporte de vencimientos de Gestión Humana fue exportado correctamente.',
    read: true,
    createdAt: isoAt(older, 15, 5),
    subjectName: 'Reportes',
    reference: 'EXP-20260805-01',
    relatedModule: 'reports',
    relatedRoute: null,
    source: 'Reportes',
    contextItems: ctx([
      { label: 'Reporte', value: 'Vencimientos' },
      { label: 'Formato', value: 'Excel' },
    ]),
    ...detail(
      [
        { label: 'Reporte', value: 'Vencimientos' },
        { label: 'Formato', value: 'Excel' },
        { label: 'Referencia', value: 'EXP-20260805-01' },
      ],
      { reportId: 'expirations', format: 'excel' }
    ),
  },
  {
    id: 'HRN-3010',
    category: 'general',
    severity: 'info',
    title: 'Mantenimiento programado del sistema',
    description: 'ELEVANT tendrá una ventana de mantenimiento el domingo de 2:00 a.m. a 4:00 a.m.',
    read: true,
    createdAt: isoAt(older, 9, 30),
    subjectName: 'Sistema',
    reference: 'SYS-2026-08',
    relatedModule: null,
    relatedRoute: null,
    source: 'Sistema',
    contextItems: ctx([
      { label: 'Evento', value: 'Mantenimiento' },
    ]),
    ...detail(
      [
        { label: 'Evento', value: 'Mantenimiento programado' },
        { label: 'Ventana', value: 'Domingo 2:00 a.m. - 4:00 a.m.' },
        { label: 'Referencia', value: 'SYS-2026-08' },
      ],
      { maintenanceWindow: 'Sunday 02:00-04:00' }
    ),
  },
  {
    id: 'HRN-3011',
    category: 'general',
    severity: 'warning',
    title: 'Sincronización pendiente con FlyAware',
    description: 'La conexión con FlyAware requiere revisión por latencia en la actualización.',
    read: false,
    createdAt: isoAt(older, 8, 40),
    subjectName: 'Integración',
    reference: 'SYNC-4821',
    relatedModule: null,
    relatedRoute: null,
    source: 'Sistema',
    contextItems: ctx([
      { label: 'Origen', value: 'FlyAware' },
    ]),
    ...detail(
      [
        { label: 'Origen', value: 'FlyAware' },
        { label: 'Estado', value: 'Retraso en sincronización' },
        { label: 'Referencia', value: 'SYNC-4821' },
      ],
      { integration: 'FlyAware', delayMinutes: 8 }
    ),
  },
  {
    id: 'HRN-3012',
    category: 'confirmations',
    severity: 'success',
    title: 'Asignación operativa confirmada',
    description: 'Luis Tavárez quedó asignado a cobertura operativa en Terminal A.',
    read: false,
    createdAt: isoAt(today, 13, 5),
    subjectName: 'Luis Tavárez',
    reference: 'ASSIGN-103',
    relatedModule: 'schedules',
    relatedRoute: null,
    source: 'Horarios',
    contextItems: ctx([
      { label: 'Agente', value: 'Luis Tavárez' },
      { label: 'Terminal', value: 'A' },
    ]),
    ...detail(
      [
        { label: 'Agente', value: 'Luis Tavárez' },
        { label: 'Terminal', value: 'A' },
        { label: 'Posición', value: 'Carga y soporte' },
        { label: 'Referencia', value: 'ASSIGN-103' },
      ],
      { agentId: 'u-19', terminal: 'A', position: 'Carga y soporte' }
    ),
  },
];

export const HUMAN_RESOURCES_NOTIFICATION_DEFAULT_PREFERENCES = {
  expirations: 'show',
  accounts: 'show',
  coverage: 'show',
  confirmations: 'show',
  general: 'show',
  expiryThresholdDays: 30,
};
