import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';

// En pruebas conserva el catálogo exhaustivo. En ejecución normal usa notificaciones persistentes del prototipo.
function usesPrototypeApi() {
  return process.env.NODE_ENV !== 'test';
}

function notifyBadgeChanged() {
  window.dispatchEvent(new CustomEvent('elevant-notifications-refresh'));
}

async function notificationsApi(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${PROTOTYPE_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(payload.error || 'No fue posible completar la operación de notificaciones.');
  return payload;
}
//
// Endpoints conceptuales que este adaptador representa (ver Claude-skills/plan-notification/skill.md):
//   GET  /notifications
//   GET  /notifications/{id}
//   GET  /notifications/unread-count
//   POST /notifications/{id}/read
//   POST /notifications/{id}/unread
//   POST /notifications/read-all
//   POST /notifications/read-many        { ids }
//   POST /notifications/unread-many      { ids }
//   GET  /notifications/preferences
//   PUT  /notifications/preferences

// PUJ / Atlantic Standard Time — mismo criterio que reviewService.js/reportsService.js.
const STATION_UTC_OFFSET_MS = 4 * 60 * 60 * 1000;

function getStationDate(daysAgo = 0) {
  const date = new Date(Date.now() - STATION_UTC_OFFSET_MS - daysAgo * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoAt(dateISO, hour, minute) {
  return `${dateISO}T${pad(hour)}:${pad(minute)}:00-04:00`;
}

const today = getStationDate(0);
const yesterday = getStationDate(1);
const thisWeek = getStationDate(4);
const older = getStationDate(20);

const NOTIFICATIONS = [
  {
    id: 'NOT-2001',
    category: 'system',
    severity: 'critical',
    title: 'FlyAware desconectado',
    description: 'No se ha recibido información actualizada de vuelos desde hace 8 minutos.',
    read: false,
    createdAt: isoAt(today, 14, 32),
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Integración FlyAware',
    metadata: { minutosSinSincronizar: 8 },
  },
  {
    id: 'NOT-2002',
    category: 'operational',
    severity: 'warning',
    title: 'Vuelo DM161 fuera de tiempo estimado',
    description: 'El vuelo DM161 no llegó a la posición asignada según la hora estimada.',
    read: false,
    createdAt: isoAt(today, 14, 20),
    flightNumber: 'DM161',
    airline: 'Arajet',
    position: 'A5',
    operationId: null,
    relatedModule: 'flight-monitoring',
    relatedRoute: 1,
    source: 'Monitoreo de vuelos',
    metadata: {},
  },
  {
    id: 'NOT-2003',
    category: 'review',
    severity: 'info',
    title: 'Nueva operación pendiente de revisión',
    description: 'El reporte de la operación del vuelo AA904 fue enviado y requiere revisión.',
    read: false,
    createdAt: isoAt(today, 10, 52),
    flightNumber: 'AA904',
    airline: 'American Airlines',
    position: 'B21',
    operationId: 'REV-1002',
    relatedModule: 'approvals',
    relatedRoute: 'REV-1002',
    source: 'Cola de revisión',
    metadata: {},
  },
  {
    id: 'NOT-2004',
    category: 'operational',
    severity: 'info',
    title: 'Posición A10 inhabilitada',
    description: 'La posición A10 fue marcada como no disponible debido a una configuración 9-Alfa.',
    read: true,
    createdAt: isoAt(today, 9, 5),
    flightNumber: null,
    airline: null,
    position: 'A10',
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Planificación operativa',
    metadata: { configuracion: '9-Alfa' },
  },
  {
    id: 'NOT-2005',
    category: 'review',
    severity: 'success',
    title: 'Operación aprobada',
    description: 'La operación del vuelo AA123 fue aprobada y enviada a Finanzas.',
    read: true,
    createdAt: isoAt(today, 8, 22),
    flightNumber: 'AA123',
    airline: 'American Airlines',
    position: 'A5',
    operationId: 'REV-0995',
    relatedModule: 'approvals',
    relatedRoute: 'REV-0995',
    source: 'Cola de revisión',
    metadata: {},
  },
  {
    id: 'NOT-2006',
    category: 'system',
    severity: 'success',
    title: 'FlyAware reconectado',
    description: 'Se restableció la sincronización de vuelos con FlyAware.',
    read: true,
    createdAt: isoAt(yesterday, 19, 40),
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Integración FlyAware',
    metadata: {},
  },
  {
    id: 'NOT-2007',
    category: 'review',
    severity: 'warning',
    title: 'Operación devuelta con correcciones',
    description: 'La operación del vuelo B6812 fue devuelta: falta evidencia de cierre de limpieza y catering.',
    read: false,
    createdAt: isoAt(yesterday, 8, 42),
    flightNumber: 'B6812',
    airline: 'JetBlue',
    position: 'A1',
    operationId: 'REV-1006',
    relatedModule: 'approvals',
    relatedRoute: 'REV-1006',
    source: 'Cola de revisión',
    metadata: {},
  },
  {
    id: 'NOT-2008',
    category: 'personal',
    severity: 'warning',
    title: 'Habilitación próxima a vencer',
    description: 'La habilitación de rampa de Carlos Medina vence en 5 días.',
    read: false,
    createdAt: isoAt(yesterday, 7, 15),
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Gestión Humana',
    metadata: { agente: 'Carlos Medina', diasRestantes: 5 },
  },
  {
    id: 'NOT-2009',
    category: 'personal',
    severity: 'critical',
    title: 'Carnet vencido',
    description: 'El carnet de seguridad aeroportuaria de Rafael Peña se encuentra vencido.',
    read: true,
    createdAt: isoAt(thisWeek, 11, 10),
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Gestión Humana',
    metadata: { agente: 'Rafael Peña' },
  },
  {
    id: 'NOT-2010',
    category: 'system',
    severity: 'warning',
    title: 'Error de sincronización',
    description: 'Se detectaron inconsistencias entre el itinerario planificado y los datos recibidos de FlyAware.',
    read: true,
    createdAt: isoAt(thisWeek, 6, 48),
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Integración FlyAware',
    metadata: {},
  },
  {
    id: 'NOT-2011',
    category: 'general',
    severity: 'info',
    title: 'Mantenimiento programado del sistema',
    description: 'ELEVANT tendrá una ventana de mantenimiento el próximo domingo de 2:00 a.m. a 4:00 a.m.',
    read: true,
    createdAt: isoAt(older, 16, 0),
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Sistema',
    metadata: {},
  },
  {
    id: 'NOT-2012',
    category: 'general',
    severity: 'info',
    title: 'Actualización de la plataforma disponible',
    description: 'Se incorporaron mejoras al módulo de Reportes. Consulte el resumen de cambios.',
    read: true,
    createdAt: isoAt(older, 9, 30),
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: 'reports',
    relatedRoute: null,
    source: 'Sistema',
    metadata: {},
  },
];

const DEFAULT_PREFERENCES = {
  operational: 'show',
  review: 'show',
  system: 'show',
  personal: 'show',
  general: 'show',
};

function structuredCloneNotification(value) {
  return JSON.parse(JSON.stringify(value));
}

let store = NOTIFICATIONS.map(structuredCloneNotification);
let preferences = { ...DEFAULT_PREFERENCES };

function findNotificationOrThrow(id) {
  const notification = store.find(item => item.id === id);
  if (!notification) throw new Error(`No existe la notificación ${id}`);
  return notification;
}

export async function getNotifications(stationCode = 'PUJ') {
  if (usesPrototypeApi()) return notificationsApi('/api/notifications');
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    notifications: store.map(structuredCloneNotification),
  };
}

export async function getNotification(id) {
  if (usesPrototypeApi()) {
    const snapshot = await notificationsApi('/api/notifications');
    const item = snapshot.notifications.find(notification => notification.id === id);
    if (!item) throw new Error(`No existe la notificación ${id}`);
    return item;
  }
  return structuredCloneNotification(findNotificationOrThrow(id));
}

export async function markNotificationAsRead(id) {
  if (usesPrototypeApi()) {
    const updated = await notificationsApi(`/api/notifications/${id}/read`, { method: 'POST' });
    notifyBadgeChanged();
    return updated;
  }
  const notification = findNotificationOrThrow(id);
  notification.read = true;
  return structuredCloneNotification(notification);
}

export async function markNotificationAsUnread(id) {
  if (usesPrototypeApi()) {
    const updated = await notificationsApi(`/api/notifications/${id}/unread`, { method: 'POST' });
    notifyBadgeChanged();
    return updated;
  }
  const notification = findNotificationOrThrow(id);
  notification.read = false;
  return structuredCloneNotification(notification);
}

export async function markNotificationsAsRead(ids) {
  return Promise.all(ids.map(id => markNotificationAsRead(id)));
}

export async function markNotificationsAsUnread(ids) {
  return Promise.all(ids.map(id => markNotificationAsUnread(id)));
}

export async function markAllNotificationsAsRead() {
  if (usesPrototypeApi()) {
    const updated = await notificationsApi('/api/notifications/read-all', { method: 'POST' });
    notifyBadgeChanged();
    return updated;
  }
  store = store.map(notification => ({ ...notification, read: true }));
  return store.map(structuredCloneNotification);
}

export async function getNotificationPreferences() {
  return { ...preferences };
}

export async function updateNotificationPreferences(nextPreferences) {
  preferences = { ...preferences, ...nextPreferences };
  return { ...preferences };
}

// Únicamente para pruebas: restaura el store mock a su estado inicial.
export function __resetNotificationsStoreForTests() {
  store = NOTIFICATIONS.map(structuredCloneNotification);
  preferences = { ...DEFAULT_PREFERENCES };
}
