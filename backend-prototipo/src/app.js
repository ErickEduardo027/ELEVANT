import { createServer } from 'node:http';
import { authenticate, closeSession, resolveSession } from './auth.js';

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
}

function sendJson(res, statusCode, payload) {
  applyCors(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function requireSession(state, req, roles = []) {
  const session = resolveSession(state.users, req.headers.authorization);
  if (!session) throw Object.assign(new Error('Sesión inválida o finalizada.'), { statusCode: 401 });
  if (roles.length && !roles.includes(session.user.role)) {
    throw Object.assign(new Error('No tienes permisos para realizar esta acción.'), { statusCode: 403 });
  }
  return session;
}

function nextId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function contractStatus(contract, reference = new Date()) {
  if (contract.statusOverride === 'disabled') return 'disabled';
  if (!contract.endDate) return 'active';
  const end = new Date(`${contract.endDate}T23:59:59`);
  const remainingDays = Math.ceil((end - reference) / 86_400_000);
  if (remainingDays < 0) return 'expired';
  if (remainingDays <= 45) return 'expiring';
  return 'active';
}

function isOperationalContract(contract, reference = new Date()) {
  return ['active', 'expiring'].includes(contractStatus(contract, reference));
}

function contractView(state, contract) {
  return {
    ...contract,
    status: contractStatus(contract),
    servicesCount: state.contractServices.filter(service => service.contractId === contract.id).length,
  };
}

function minutesBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60_000));
}

function reviewOperationView(state, operation) {
  const flight = state.flights.find(item => item.id === operation.flightId) ?? {};
  const incidents = state.incidents.filter(item => item.flightId === operation.flightId);
  const agentName = flight.agents?.[0] ?? 'Agente de rampa';
  const duration = minutesBetween(operation.startedAt, operation.endedAt);
  const reviewStatus = operation.reviewStatus ?? 'PENDING_REVIEW';
  return {
    id: operation.id, status: reviewStatus, priority: incidents.some(item => item.impact === 'Alto') ? 'HIGH' : 'NORMAL',
    flight: { number: flight.flightNumber, airline: flight.airlineName, airlineIata: flight.airlineIata, origin: flight.origin, destination: flight.destination, aircraftType: flight.aircraftType, registration: null },
    schedule: { sta: flight.scheduledTime, ata: flight.estimatedTime, std: flight.scheduledTime, atd: operation.endedAt },
    position: flight.position ?? 'Sin posición', agent: { id: flight.agentIds?.[0] ?? null, name: agentName }, supervisor: { id: null, name: flight.supervisor ?? 'Administrador OCC' },
    submittedAt: operation.submittedAt ?? operation.endedAt, approvedAt: operation.approvedAt ?? null,
    planned: { position: flight.position, startTime: flight.estimatedTime, agents: flight.agentIds?.length ?? 0, teams: flight.teams?.length ?? 0, services: flight.services ?? [], duration, supervisor: flight.supervisor ?? 'Administrador OCC' },
    actual: { position: flight.position, startTime: operation.startedAt, agents: flight.agentIds?.length ?? 0, teams: flight.teams?.length ?? 0, services: flight.services ?? [], duration, supervisor: flight.supervisor ?? 'Administrador OCC' },
    timeline: { blocksOn: operation.startedAt, doorsOpen: null, loadingStart: null, loadingEnd: null, boardingStart: null, firstPax: null, lastPax: null, firstBag: null, lastBag: null, doorsClose: null, blocksOff: operation.endedAt },
    services: (flight.services ?? []).map(name => ({ name, status: 'completed' })), equipment: [],
    incidents: incidents.map(item => ({ id: item.id, type: item.type, severity: item.impact === 'Alto' ? 'high' : item.impact === 'Medio' ? 'medium' : 'low', status: 'open', description: item.description, reportedBy: agentName, occurredAt: item.createdAt, observation: item.imageUri ? 'Incluye evidencia adjunta desde la aplicación móvil.' : '' })),
    evidence: operation.checklist ? [{ id: `CHK-${operation.id}`, name: `Checklist ${flight.flightNumber}`, type: 'checklist', user: agentName, date: operation.checklist.completedAt, status: 'available' }] : [],
    signatures: [{ name: agentName, role: 'Agente de rampa', status: 'signed', timestamp: operation.endedAt }],
    observations: [], reconciliation: [],
    history: operation.history ?? [], returnReason: operation.returnReason ?? null,
  };
}

function approvedServiceRows(state) {
  return state.operations
    .filter(operation => operation.reviewStatus === 'APPROVED')
    .flatMap(operation => {
      const flight = state.flights.find(item => item.id === operation.flightId);
      if (!flight) return [];
      return (flight.serviceIds ?? []).map(serviceId => {
        const service = state.contractServices.find(item => item.id === serviceId);
        if (!service) return null;
        const id = `${operation.id}:${service.id}`;
        return {
          id,
          operationId: operation.id,
          serviceId: service.id,
          airline: flight.airlineName,
          flight: flight.flightNumber,
          date: String(operation.approvedAt ?? operation.endedAt ?? '').slice(0, 10),
          approvedAt: operation.approvedAt,
          service: service.name,
          contract: flight.contractId,
          amount: Number(service.rate ?? 0),
          currency: service.currency ?? 'USD',
          status: (operation.financeReviewedServiceIds ?? []).includes(service.id) ? 'reviewed' : 'pending',
        };
      }).filter(Boolean);
    });
}

function preinvoiceView(item) {
  return {
    ...item,
    services: item.serviceIds?.length ?? item.services ?? 0,
  };
}

function financeReportView(state) {
  const rows = approvedServiceRows(state);
  const preinvoices = state.preinvoices ?? [];
  const airlines = [...new Set([...rows.map(item => item.airline), ...preinvoices.map(item => item.airline)])];
  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      approvedServices: rows.length,
      preinvoiced: preinvoices.reduce((total, item) => total + (item.serviceIds?.length ?? 0), 0),
      reconciled: preinvoices.filter(item => item.status === 'sent').length,
      differences: 0,
    },
    byAirline: airlines.map(airline => {
      const approved = rows.filter(item => item.airline === airline);
      const billed = preinvoices.filter(item => item.airline === airline && ['approved', 'sent'].includes(item.status));
      const currencies = [...new Set([...approved.map(item => item.currency), ...billed.map(item => item.currency)])];
      return {
        airline, approved: approved.length,
        billed: billed.reduce((total, item) => total + (item.serviceIds?.length ?? 0), 0),
        amount: billed.reduce((total, item) => total + Number(item.total ?? 0), 0),
        currency: currencies.length === 1 ? currencies[0] : 'USD',
      };
    }),
    audit: state.audit.filter(item => item.action === 'finance_report_exported').slice(0, 20)
      .map(item => ({ id: item.id, format: item.detail, user: item.actorName, exportedAt: item.occurredAt })),
  };
}

function operationalReportRecords(state) {
  return state.operations.filter(operation => operation.endedAt).map(operation => {
    const flight = state.flights.find(item => item.id === operation.flightId) ?? {};
    const services = (flight.serviceIds ?? []).map(serviceId => state.contractServices.find(item => item.id === serviceId)).filter(Boolean);
    const actualMinutes = minutesBetween(operation.startedAt, operation.endedAt);
    return {
      id: operation.id,
      flight: { number: flight.flightNumber, airline: flight.airlineName, airlineIata: flight.airlineIata },
      terminal: flight.destination === 'PUJ' ? 'PUJ' : flight.destination ?? 'PUJ',
      aircraftType: flight.aircraftType ?? 'Sin registrar',
      date: String(operation.endedAt).slice(0, 10),
      position: { assigned: flight.position ?? 'Sin posición', final: flight.position ?? 'Sin posición' },
      positionChange: null,
      reportedAt: operation.submittedAt ?? operation.endedAt,
      actualBlockAt: operation.endedAt,
      flightStatus: flight.flightStatus ?? 'arrived',
      agent: { id: flight.agentIds?.[0] ?? null, name: flight.agents?.[0] ?? 'Agente de rampa' },
      groundTime: { contractedMinutes: actualMinutes, actualMinutes },
      services: services.map(service => ({ name: service.name, contractedQty: 1, executedQty: 1 })),
      incidents: state.incidents.filter(item => item.flightId === operation.flightId).length,
    };
  });
}

function contractReportView(state) {
  const airlines = [...new Set(state.contracts.map(contract => contract.airline))];
  return {
    generatedAt: new Date().toISOString(),
    rows: airlines.map(airline => {
      const contracts = state.contracts.filter(contract => contract.airline === airline);
      const services = state.contractServices.filter(service => contracts.some(contract => contract.id === service.contractId));
      return {
        airline,
        activeContracts: contracts.filter(contract => contractStatus(contract) === 'active').length,
        expiringContracts: contracts.filter(contract => contractStatus(contract) === 'expiring').length,
        services: services.length,
        estimatedValue: services.reduce((total, service) => total + Number(service.rate ?? 0), 0),
      };
    }),
  };
}

function ensureChatCollections(state) {
  state.chats ??= [];
  state.messages ??= [];
}

const DEPARTMENT_ROLES = ['ADMIN_OCC', 'CONTRATOS', 'FINANZAS', 'GESTION_HUMANA'];
const DEPARTMENT_LABELS = {
  ADMIN_OCC: 'Administrador / OCC',
  CONTRATOS: 'Departamento de Contratos',
  FINANZAS: 'Departamento de Finanzas',
  GESTION_HUMANA: 'Gestión Humana',
};

function ensureDepartmentMessages(state) {
  state.departmentMessages ??= [];
}

function departmentMessageView(message) {
  return {
    ...message,
    senderLabel: DEPARTMENT_LABELS[message.senderRole] ?? message.senderRole,
    recipientLabel: DEPARTMENT_LABELS[message.recipientRole] ?? message.recipientRole,
  };
}

function findAgentRecord(state, personnelId) {
  return state.personnel.find(item => item.identity?.id === personnelId) ?? null;
}

function ensureAgentChat(state, personnelId) {
  ensureChatCollections(state);
  let chat = state.chats.find(item => item.agentId === personnelId && item.status !== 'closed');
  if (chat) return chat;
  const agent = findAgentRecord(state, personnelId);
  if (!agent) throw Object.assign(new Error('No existe el agente asociado a la conversación.'), { statusCode: 404 });
  const flight = state.flights.find(item => item.agentIds?.includes(personnelId)) ?? null;
  chat = {
    id: nextId('CHAT'), agentId: personnelId,
    agentName: `${agent.identity.firstName} ${agent.identity.lastName}`.trim(),
    flightId: flight?.id ?? null, flightNumber: flight?.flightNumber ?? 'Sin vuelo',
    airline: flight?.airlineName ?? 'AVIAM', origin: flight?.origin ?? null,
    destination: flight?.destination ?? 'PUJ', position: flight?.position ?? null,
    operationId: state.operations.find(item => item.flightId === flight?.id)?.id ?? null,
    agentStatus: 'online', status: 'active', requiresAttention: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  state.chats.unshift(chat);
  return chat;
}

function chatMessageView(message) {
  return {
    id: message.id, clientId: message.clientId ?? null, conversationId: message.chatId,
    type: 'message', senderId: message.senderId ?? null, senderRole: message.senderRole,
    senderName: message.senderName, content: message.content, createdAt: message.createdAt,
    readAt: message.readAt ?? null, status: message.status ?? 'delivered', attachments: message.attachments ?? [],
  };
}

function chatConversationView(state, chat) {
  const messages = state.messages.filter(item => item.chatId === chat.id)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  const last = messages.at(-1) ?? null;
  return {
    ...chat,
    lastMessage: last?.content ?? '', lastMessageAt: last?.createdAt ?? chat.updatedAt,
    unreadCount: messages.filter(item => item.senderRole === 'agent' && !item.readAt).length,
  };
}

function appendChatMessage(state, chat, { clientId = null, senderId = null, senderRole, senderName, content, attachments = [] }) {
  ensureChatCollections(state);
  if (clientId) {
    const existing = state.messages.find(item => item.clientId === clientId && item.chatId === chat.id);
    if (existing) return existing;
  }
  const message = {
    id: nextId('MSG'), clientId, chatId: chat.id, senderId, senderRole, senderName,
    content: String(content ?? '').trim(), attachments, createdAt: new Date().toISOString(),
    readAt: null, status: 'delivered',
  };
  if (!message.content) throw Object.assign(new Error('El mensaje no puede estar vacío.'), { statusCode: 400 });
  state.messages.push(message);
  chat.updatedAt = message.createdAt;
  if (senderRole === 'agent') chat.requiresAttention = true;
  return message;
}

function roleDefinition(roleId) {
  const roles = {
    'role-admin-occ': { name: 'Administrador OCC', userType: 'admin_occ', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar', 'Aprobar', 'Exportar', 'Administrar'] },
    'role-analista-occ': { name: 'Analista OCC', userType: 'admin_occ', portal: 'back_office', permissions: ['Consultar', 'Editar', 'Exportar'] },
    'role-contratos': { name: 'Gestor de Contratos', userType: 'contracts', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar', 'Exportar'] },
    'role-finanzas': { name: 'Analista de Finanzas', userType: 'finance', portal: 'back_office', permissions: ['Consultar', 'Editar', 'Exportar'] },
    'role-rrhh-admin': { name: 'Administrador de Gestión Humana', userType: 'human_resources', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar', 'Administrar'] },
    'role-rrhh-generalista': { name: 'Generalista de Gestión Humana', userType: 'human_resources', portal: 'back_office', permissions: ['Consultar', 'Crear', 'Editar'] },
    'role-agente-rampa': { name: 'Agente de Rampa', userType: 'ramp_agent', portal: 'ramp_mobile_app', permissions: ['Consultar', 'Crear'] },
    'role-usuario-aerolinea': { name: 'Usuario de Aerolínea', userType: 'airline_client', portal: 'airline_portal', permissions: ['Consultar', 'Exportar'] },
  };
  return roles[roleId] ? { id: roleId, ...roles[roleId] } : null;
}

function appendAudit(state, session, action, affectedUserId, detail = null) {
  const entry = {
    id: nextId('AUD'),
    action,
    actorId: session.user.id,
    actorName: session.user.name,
    affectedUserId,
    occurredAt: new Date().toISOString(),
    ...(detail ? { detail } : {}),
  };
  state.audit.unshift(entry);
  return entry;
}

const EQUIPMENT_TYPES = [
  { id: 'bridge', name: 'Puente de abordaje' },
  { id: 'gpu', name: 'GPU' },
  { id: 'air-conditioning', name: 'Aire acondicionado' },
  { id: 'baggage', name: 'Equipaje' },
  { id: 'cabin-cleaning', name: 'Limpieza de cabina' },
  { id: 'catering', name: 'Catering' },
  { id: 'fuel', name: 'Combustible' },
  { id: 'pushback', name: 'Pushback' },
  { id: 'stairs', name: 'Escalera de servicio' },
  { id: 'water', name: 'Agua potable' },
  { id: 'lavatory', name: 'Servicio sanitario' },
];

const HR_POSITIONS = [
  { id: 'gpu', name: 'GPU (unidad de poder en tierra)', requiresQualification: true },
  { id: 'bridge', name: 'Puente de abordaje', requiresQualification: true },
  { id: 'baggage', name: 'Equipaje', requiresQualification: true },
  { id: 'ramp-agent', name: 'Agente de rampa', requiresQualification: false },
  { id: 'supervisor', name: 'Supervisor de rampa', requiresQualification: false },
];

const SHIFT_BLOCKS = [
  { id: 'morning', label: 'Mañana', startTime: '06:00', endTime: '14:00' },
  { id: 'afternoon', label: 'Tarde', startTime: '14:00', endTime: '22:00' },
  { id: 'night', label: 'Noche', startTime: '22:00', endTime: '06:00' },
];

function ensureHumanResourcesCollections(state) {
  state.qualifications ??= [];
  state.qualificationHistory ??= [];
  state.permits ??= [];
  state.permitHistory ??= [];
  state.shifts ??= [];
  state.availabilityRequests ??= [];
}

function rampAgentView(record) {
  return {
    agentId: record.identity.id,
    agentName: `${record.identity.firstName} ${record.identity.lastName}`.trim(),
    employeeNumber: record.rampAgent?.employeeNumber ?? '',
    terminals: record.rampAgent?.terminals ?? [],
  };
}

function isCurrentDate(value, reference = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date >= reference;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value ?? '').split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null;
}

function shiftCoversDateTime(shift, scheduledTime) {
  const scheduled = new Date(scheduledTime);
  if (!Number.isFinite(scheduled.getTime()) || shift.date !== scheduledTime.slice(0, 10)) return false;
  const current = scheduled.getHours() * 60 + scheduled.getMinutes();
  const start = timeToMinutes(shift.startTime);
  const end = timeToMinutes(shift.endTime);
  if (start === null || end === null) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function agentEligibility(state, record, scheduledTime = null) {
  ensureHumanResourcesCollections(state);
  const now = new Date();
  const active = record.account?.status === 'active';
  const qualifications = state.qualifications.filter(item => item.agentId === record.identity.id && isCurrentDate(item.expiresAt, now));
  const permits = state.permits.filter(item => item.agentId === record.identity.id && isCurrentDate(item.expiresAt, now));
  const permitTypes = new Set(permits.map(item => item.type));
  const hasDocuments = permitTypes.has('carnet') && permitTypes.has('licencia');
  const shifts = state.shifts.filter(item => item.agentId === record.identity.id);
  const hasShift = scheduledTime
    ? shifts.some(item => shiftCoversDateTime(item, scheduledTime))
    : shifts.some(item => item.date >= new Date().toISOString().slice(0, 10));
  const reasons = [];
  if (!active) reasons.push('Cuenta inactiva');
  if (!qualifications.length) reasons.push('Sin habilitación vigente');
  if (!hasDocuments) reasons.push('Carnet o licencia no vigente');
  if (!hasShift) reasons.push('Sin turno compatible');
  return { eligible: active && qualifications.length > 0 && hasDocuments && hasShift, reasons };
}

function appendNotification(state, {
  recipientRole,
  category = 'general',
  severity = 'info',
  title,
  description,
  source = 'Sistema ELEVANT',
  flight = null,
  operationId = null,
  relatedModule = null,
  relatedRoute = null,
  metadata = {},
}) {
  state.notifications ??= [];
  const item = {
    id: nextId('NOT'), recipientRole, category, severity, title, description,
    read: false, createdAt: new Date().toISOString(), flightNumber: flight?.flightNumber ?? null,
    airline: flight?.airlineName ?? null, position: flight?.position ?? null,
    operationId, relatedModule, relatedRoute, source, metadata,
  };
  state.notifications.unshift(item);
  return item;
}

function findPersonnel(state, personnelId) {
  const record = state.personnel.find(item => item.identity.id === personnelId);
  if (!record) throw Object.assign(new Error('Usuario no encontrado.'), { statusCode: 404 });
  return record;
}

function syncMobileAccount(state, record) {
  if (record.userType !== 'ramp_agent') return;
  const existing = state.users.find(item => item.personnelId === record.identity.id);
  const account = {
    id: existing?.id ?? nextId('USR-AGENT'),
    personnelId: record.identity.id,
    email: String(record.identity.email).trim().toLowerCase(),
    password: existing?.password ?? 'Elevant2026!',
    name: `${record.identity.firstName} ${record.identity.lastName}`.trim(),
    role: 'AGENTE_RAMPA',
    roleLabel: 'Agente de Rampa',
    active: record.account.status === 'active',
  };
  if (existing) Object.assign(existing, account);
  else state.users.push(account);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('El cuerpo debe contener JSON válido.'), { statusCode: 400 });
  }
}

export function createApp({ store }) {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        applyCors(res);
        res.writeHead(204);
        return res.end();
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        const state = await store.read();
        return sendJson(res, 200, {
          status: 'ok',
          service: 'elevant-backend-prototipo',
          schemaVersion: state.schemaVersion,
          persistence: 'json-local',
          timestamp: new Date().toISOString(),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/system/info') {
        const state = await store.read();
        return sendJson(res, 200, {
          schemaVersion: state.schemaVersion,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const state = await store.read();
        const credentials = await readJsonBody(req);
        const session = authenticate(state.users, credentials);

        if (!session) return sendJson(res, 401, { error: 'Credenciales inválidas.' });
        return sendJson(res, 200, session);
      }

      if (req.method === 'POST' && url.pathname === '/api/mobile/auth/login') {
        const state = await store.read();
        const credentials = await readJsonBody(req);
        const session = authenticate(state.users, credentials);
        if (!session || session.user.role !== 'AGENTE_RAMPA') {
          if (session) closeSession(`Bearer ${session.token}`);
          return sendJson(res, 401, { error: 'Credenciales de Agente de Rampa inválidas.' });
        }
        return sendJson(res, 200, session);
      }

      if (req.method === 'POST' && url.pathname === '/api/public/service-requests') {
        const payload = await readJsonBody(req);
        const airline = String(payload.airline ?? '').trim();
        const contactName = String(payload.contactName ?? '').trim();
        const contactEmail = String(payload.contactEmail ?? '').trim().toLowerCase();
        const requestedService = String(payload.requestedService ?? '').trim();
        const type = payload.type === 'additionalService' ? 'additionalService' : 'affiliation';
        if (!airline || !contactName || !contactEmail || !requestedService) {
          throw Object.assign(new Error('Faltan datos obligatorios de la solicitud.'), { statusCode: 400 });
        }
        const created = await store.update(state => {
          const receivedAt = new Date().toISOString();
          const request = {
            id: nextId('SOL'), airline, contactName, contactEmail, type, requestedService,
            receivedAt, updatedAt: receivedAt, status: 'pending', decisionNote: '', notifiedAt: null,
            details: payload.details ?? null,
          };
          state.serviceRequests.unshift(request);
          appendNotification(state, {
            recipientRole: 'CONTRATOS', category: 'general', severity: 'info',
            title: 'Nueva solicitud de servicio',
            description: `${airline} envió una solicitud de ${requestedService}.`,
            source: 'Portal de aerolíneas', relatedModule: 'contract-requests', relatedRoute: request.id,
            metadata: { requestId: request.id, type },
          });
          return request;
        });
        return sendJson(res, 201, created);
      }

      if (req.method === 'GET' && url.pathname === '/api/public/service-requests') {
        const state = await store.read();
        const contactEmail = String(url.searchParams.get('contactEmail') ?? '').trim().toLowerCase();
        if (!contactEmail) {
          throw Object.assign(new Error('El correo de seguimiento es obligatorio.'), { statusCode: 400 });
        }
        const requests = state.serviceRequests
          .filter(item => item.contactEmail === contactEmail)
          .sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)));
        return sendJson(res, 200, requests);
      }

      const publicRequestCancelMatch = url.pathname.match(/^\/api\/public\/service-requests\/([^/]+)\/cancel$/);
      if (publicRequestCancelMatch && req.method === 'POST') {
        const payload = await readJsonBody(req);
        const contactEmail = String(payload.contactEmail ?? '').trim().toLowerCase();
        const reason = String(payload.reason ?? '').trim();
        if (!contactEmail || !reason) {
          throw Object.assign(new Error('El correo y el motivo de cancelación son obligatorios.'), { statusCode: 400 });
        }
        const updated = await store.update(state => {
          const request = state.serviceRequests.find(item => item.id === publicRequestCancelMatch[1] && item.contactEmail === contactEmail);
          if (!request) throw Object.assign(new Error('La solicitud no existe o no pertenece al usuario.'), { statusCode: 404 });
          if (request.status !== 'pending') {
            throw Object.assign(new Error('La solicitud ya no puede cancelarse.'), { statusCode: 409 });
          }
          request.status = 'cancelled';
          request.cancellationReason = reason;
          request.updatedAt = new Date().toISOString();
          return request;
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/contracts/requests') {
        const state = await store.read();
        requireSession(state, req, ['CONTRATOS']);
        return sendJson(res, 200, state.serviceRequests);
      }

      const contractRequestAction = url.pathname.match(/^\/api\/contracts\/requests\/([^/]+)\/(review|resolve)$/);
      if (contractRequestAction && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['CONTRATOS']);
        const payload = await readJsonBody(req);
        const [, requestId, action] = contractRequestAction;
        const updated = await store.update(state => {
          const request = state.serviceRequests.find(item => item.id === requestId);
          if (!request) throw Object.assign(new Error('La solicitud no existe.'), { statusCode: 404 });
          if (action === 'review') request.status = 'inReview';
          if (action === 'resolve') {
            if (!['approved', 'rejected'].includes(payload.status)) {
              throw Object.assign(new Error('La decisión seleccionada no es válida.'), { statusCode: 400 });
            }
            const note = String(payload.decisionNote ?? '').trim();
            if (!note) throw Object.assign(new Error('Debe registrar una observación.'), { statusCode: 400 });
            request.status = payload.status;
            request.decisionNote = note;
            request.notifiedAt = new Date().toISOString();
          }
          request.updatedAt = new Date().toISOString();
          appendAudit(state, session, `service_request_${action}`, request.id);
          return request;
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/contracts/contracts') {
        const state = await store.read();
        requireSession(state, req, ['CONTRATOS', 'ADMIN_OCC', 'FINANZAS']);
        return sendJson(res, 200, state.contracts.map(contract => contractView(state, contract)));
      }

      if (req.method === 'GET' && url.pathname === '/api/contracts/reports') {
        const state = await store.read();
        requireSession(state, req, ['CONTRATOS']);
        return sendJson(res, 200, contractReportView(state));
      }

      if (req.method === 'POST' && url.pathname === '/api/contracts/reports/export') {
        const current = await store.read();
        const session = requireSession(current, req, ['CONTRATOS']);
        const payload = await readJsonBody(req);
        if (!['PDF', 'Excel'].includes(payload.format)) {
          throw Object.assign(new Error('El formato debe ser PDF o Excel.'), { statusCode: 400 });
        }
        const result = await store.update(state => {
          const entry = appendAudit(state, session, 'contract_report_exported', session.user.id, payload.format);
          return { id: entry.id, format: payload.format, airline: payload.airline ?? 'all', user: session.user.name, exportedAt: entry.occurredAt };
        });
        return sendJson(res, 201, result);
      }

      if (req.method === 'POST' && url.pathname === '/api/contracts/contracts') {
        const current = await store.read();
        const session = requireSession(current, req, ['CONTRATOS']);
        const payload = await readJsonBody(req);
        const requestId = String(payload.requestId ?? '').trim();
        const airline = String(payload.airline ?? '').trim();
        const airlineCode = String(payload.airlineCode ?? '').trim().toUpperCase();
        const startDate = String(payload.startDate ?? '').trim();
        const endDate = payload.contractType === 'permanent' ? null : String(payload.endDate ?? '').trim();
        const conditions = String(payload.conditions ?? '').trim();
        const contractType = payload.contractType === 'permanent' ? 'permanent' : 'temporary';
        if (!requestId || !airline || !airlineCode || !startDate || !conditions || (contractType === 'temporary' && !endDate)) {
          throw Object.assign(new Error('Faltan datos obligatorios del contrato.'), { statusCode: 400 });
        }
        const created = await store.update(state => {
          const request = state.serviceRequests.find(item => item.id === requestId);
          if (!request || request.status !== 'approved') {
            throw Object.assign(new Error('El contrato requiere una solicitud aprobada.'), { statusCode: 409 });
          }
          if (request.contractId) {
            throw Object.assign(new Error('La solicitud ya tiene un contrato asociado.'), { statusCode: 409 });
          }
          const sequence = state.contracts.length + 1;
          const contract = {
            id: `CTR-${new Date().getFullYear()}-${String(sequence).padStart(3, '0')}`,
            requestId, airline, airlineCode, contractType, startDate, endDate,
            conditions, statusOverride: null, createdAt: new Date().toISOString(),
          };
          state.contracts.unshift(contract);
          request.contractId = contract.id;
          for (const recipientRole of ['ADMIN_OCC', 'FINANZAS']) {
            appendNotification(state, {
              recipientRole, category: 'operational', severity: 'success',
              title: 'Nuevo contrato disponible',
              description: `${contract.id} de ${contract.airline} fue creado y está disponible para el flujo operativo.`,
              source: 'Contratos', metadata: { contractId: contract.id },
            });
          }
          appendAudit(state, session, 'contract_created', contract.id, `Solicitud ${requestId}`);
          return contractView(state, contract);
        });
        return sendJson(res, 201, created);
      }

      const contractMatch = url.pathname.match(/^\/api\/contracts\/contracts\/([^/]+)$/);
      if (contractMatch && req.method === 'PATCH') {
        const current = await store.read();
        const session = requireSession(current, req, ['CONTRATOS']);
        const payload = await readJsonBody(req);
        const updated = await store.update(state => {
          const contract = state.contracts.find(item => item.id === contractMatch[1]);
          if (!contract) throw Object.assign(new Error('El contrato solicitado no existe.'), { statusCode: 404 });
          const type = payload.contractType ?? contract.contractType;
          contract.contractType = type === 'permanent' ? 'permanent' : 'temporary';
          contract.endDate = contract.contractType === 'permanent' ? null : String(payload.endDate ?? contract.endDate ?? '').trim();
          contract.conditions = String(payload.conditions ?? contract.conditions).trim();
          contract.statusOverride = payload.disabled ? 'disabled' : null;
          contract.updatedAt = new Date().toISOString();
          appendAudit(state, session, 'contract_updated', contract.id);
          return contractView(state, contract);
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/contracts/services') {
        const state = await store.read();
        requireSession(state, req, ['CONTRATOS', 'ADMIN_OCC', 'FINANZAS']);
        return sendJson(res, 200, state.contractServices);
      }

      if (req.method === 'POST' && url.pathname === '/api/contracts/services') {
        const current = await store.read();
        const session = requireSession(current, req, ['CONTRATOS']);
        const payload = await readJsonBody(req);
        const rate = Number(payload.rate);
        if (!payload.contractId || !String(payload.name ?? '').trim() || !(rate > 0) || !payload.currency || !payload.billingUnit || !payload.startDate) {
          throw Object.assign(new Error('Faltan datos obligatorios del servicio pactado.'), { statusCode: 400 });
        }
        const created = await store.update(state => {
          const contract = state.contracts.find(item => item.id === payload.contractId);
          if (!contract) throw Object.assign(new Error('El contrato asociado no existe.'), { statusCode: 404 });
          const service = {
            id: `SRV-${String(state.contractServices.length + 1).padStart(3, '0')}`,
            contractId: contract.id, airline: contract.airline, name: String(payload.name).trim(),
            rate, currency: payload.currency, billingUnit: payload.billingUnit,
            startDate: payload.startDate,
            endDate: contract.contractType === 'permanent' ? null : (payload.endDate || contract.endDate),
            active: true, createdAt: new Date().toISOString(),
          };
          state.contractServices.unshift(service);
          appendAudit(state, session, 'contract_service_created', service.id, contract.id);
          return service;
        });
        return sendJson(res, 201, created);
      }

      const serviceMatch = url.pathname.match(/^\/api\/contracts\/services\/([^/]+)$/);
      if (serviceMatch && req.method === 'PATCH') {
        const current = await store.read();
        const session = requireSession(current, req, ['CONTRATOS']);
        const payload = await readJsonBody(req);
        const updated = await store.update(state => {
          const service = state.contractServices.find(item => item.id === serviceMatch[1]);
          if (!service) throw Object.assign(new Error('El servicio pactado no existe.'), { statusCode: 404 });
          if (payload.rate !== undefined) service.rate = Number(payload.rate);
          if (payload.currency) service.currency = payload.currency;
          if (payload.billingUnit) service.billingUnit = payload.billingUnit;
          if (payload.endDate !== undefined) service.endDate = payload.endDate || null;
          if (payload.active !== undefined) service.active = Boolean(payload.active);
          service.updatedAt = new Date().toISOString();
          appendAudit(state, session, 'contract_service_updated', service.id);
          return service;
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/occ/planning') {
        const state = await store.read();
        requireSession(state, req, ['ADMIN_OCC']);
        return sendJson(res, 200, { station: { code: 'PUJ', localAbbr: 'AST' }, date: url.searchParams.get('date') || new Date().toISOString().slice(0, 10), flights: state.flights });
      }

      if (req.method === 'GET' && url.pathname === '/api/occ/planning/options') {
        const state = await store.read();
        requireSession(state, req, ['ADMIN_OCC']);
        const scheduledTime = url.searchParams.get('scheduledTime') || null;
        const contracts = state.contracts.filter(contract => isOperationalContract(contract));
        const agents = state.personnel
          .filter(record => record.userType === 'ramp_agent')
          .map(record => {
            const eligibility = agentEligibility(state, record, scheduledTime);
            return {
              id: record.identity.id,
              name: `${record.identity.firstName} ${record.identity.lastName}`.trim(),
              terminals: record.rampAgent?.terminals ?? [],
              eligible: eligibility.eligible,
              eligibilityReasons: eligibility.reasons,
            };
          });
        return sendJson(res, 200, {
          contracts: contracts.map(contract => contractView(state, contract)),
          services: state.contractServices.filter(service => service.active && contracts.some(contract => contract.id === service.contractId)),
          agents,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/occ/flights') {
        const current = await store.read();
        const session = requireSession(current, req, ['ADMIN_OCC']);
        const payload = await readJsonBody(req);
        const required = ['contractId', 'flightNumber', 'origin', 'destination', 'scheduledTime', 'aircraftType'];
        if (required.some(field => !String(payload[field] ?? '').trim())) {
          throw Object.assign(new Error('Faltan datos obligatorios del vuelo.'), { statusCode: 400 });
        }
        const created = await store.update(state => {
          const contract = state.contracts.find(item => item.id === payload.contractId && isOperationalContract(item));
          if (!contract) throw Object.assign(new Error('El vuelo requiere un contrato activo.'), { statusCode: 409 });
          const flight = {
            id: nextId('FLT'), contractId: contract.id, airlineIata: contract.airlineCode,
            airlineName: contract.airline, flightNumber: String(payload.flightNumber).trim().toUpperCase(),
            status: payload.status || 'scheduled', scheduledTime: payload.scheduledTime,
            estimatedTime: payload.scheduledTime, origin: String(payload.origin).trim().toUpperCase(),
            destination: String(payload.destination).trim().toUpperCase(), aircraftType: String(payload.aircraftType).trim(),
            position: String(payload.position ?? '').trim() || null, station: 'PUJ', supervisor: null,
            agents: [], agentIds: [], teams: [], services: [], serviceIds: [], conflict: null,
            observations: String(payload.observations ?? '').trim(),
            history: [{ at: new Date().toISOString(), note: 'Vuelo registrado por OCC' }],
            operationStatus: 'pending', createdAt: new Date().toISOString(),
          };
          state.flights.unshift(flight);
          appendAudit(state, session, 'flight_created', flight.id, contract.id);
          return flight;
        });
        return sendJson(res, 201, created);
      }

      const assignFlightMatch = url.pathname.match(/^\/api\/occ\/flights\/([^/]+)\/assign$/);
      if (assignFlightMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['ADMIN_OCC']);
        const payload = await readJsonBody(req);
        const assigned = await store.update(state => {
          const flight = state.flights.find(item => item.id === assignFlightMatch[1]);
          if (!flight) throw Object.assign(new Error('El vuelo no existe.'), { statusCode: 404 });
          const agent = state.personnel.find(record => record.identity.id === payload.agentId && record.userType === 'ramp_agent');
          if (!agent) throw Object.assign(new Error('El agente no existe o no es Agente de Rampa.'), { statusCode: 409 });
          const eligibility = agentEligibility(state, agent, flight.scheduledTime);
          if (!eligibility.eligible) throw Object.assign(new Error(`El agente no está disponible: ${eligibility.reasons.join(', ')}.`), { statusCode: 409 });
          const allowedServices = state.contractServices.filter(service => service.contractId === flight.contractId && service.active);
          const selectedServices = allowedServices.filter(service => (payload.serviceIds ?? []).includes(service.id));
          if (!selectedServices.length) throw Object.assign(new Error('Seleccione al menos un servicio pactado.'), { statusCode: 400 });
          flight.agentIds = [agent.identity.id];
          flight.agents = [`${agent.identity.firstName} ${agent.identity.lastName}`.trim()];
          flight.serviceIds = selectedServices.map(service => service.id);
          flight.services = selectedServices.map(service => service.name);
          flight.position = String(payload.position ?? flight.position ?? '').trim() || null;
          flight.history.unshift({ at: new Date().toISOString(), note: `Asignado a ${flight.agents[0]} y enviado al móvil` });
          state.assignments.unshift({ id: nextId('ASG'), flightId: flight.id, agentId: agent.identity.id, serviceIds: flight.serviceIds, assignedAt: new Date().toISOString() });
          appendNotification(state, {
            recipientRole: 'AGENTE_RAMPA', category: 'operational', severity: 'info',
            title: 'Nueva asignación de vuelo',
            description: `${flight.flightNumber} fue asignado a ${flight.agents[0]}.`,
            source: 'Planificación OCC', flight, metadata: { personnelId: agent.identity.id },
          });
          appendAudit(state, session, 'flight_assigned', flight.id, agent.identity.id);
          return flight;
        });
        return sendJson(res, 200, assigned);
      }

      if (req.method === 'GET' && url.pathname === '/api/mobile/flights') {
        const state = await store.read();
        const session = requireSession(state, req, ['AGENTE_RAMPA']);
        const personnelId = session.user.personnelId;
        return sendJson(res, 200, state.flights.filter(flight => flight.agentIds?.includes(personnelId)));
      }

      if (req.method === 'GET' && url.pathname === '/api/mobile/chat') {
        const current = await store.read();
        const session = requireSession(current, req, ['AGENTE_RAMPA']);
        const result = await store.update(state => {
          const chat = ensureAgentChat(state, session.user.personnelId);
          const messages = state.messages.filter(item => item.chatId === chat.id)
            .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
          for (const message of messages) {
            if (message.senderRole === 'occ' && !message.readAt) message.readAt = new Date().toISOString();
          }
          return { conversation: chatConversationView(state, chat), messages: messages.map(chatMessageView) };
        });
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' && url.pathname === '/api/internal-chat/messages') {
        const state = await store.read();
        const session = requireSession(state, req, DEPARTMENT_ROLES);
        ensureDepartmentMessages(state);
        const messages = state.departmentMessages
          .filter(item => item.senderRole === session.user.role || item.recipientRole === session.user.role)
          .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
          .map(departmentMessageView);
        return sendJson(res, 200, {
          currentRole: session.user.role,
          participants: DEPARTMENT_ROLES
            .filter(role => role !== session.user.role)
            .map(role => ({ role, label: DEPARTMENT_LABELS[role] })),
          messages,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/internal-chat/messages') {
        const current = await store.read();
        const session = requireSession(current, req, DEPARTMENT_ROLES);
        const payload = await readJsonBody(req);
        const recipientRole = String(payload.recipientRole ?? '').trim().toUpperCase();
        const content = String(payload.content ?? '').trim();
        if (!DEPARTMENT_ROLES.includes(recipientRole) || recipientRole === session.user.role) {
          throw Object.assign(new Error('Seleccione un departamento destinatario válido.'), { statusCode: 400 });
        }
        if (!content) throw Object.assign(new Error('El mensaje no puede estar vacío.'), { statusCode: 400 });
        const message = await store.update(state => {
          ensureDepartmentMessages(state);
          const created = {
            id: nextId('DMSG'), senderRole: session.user.role, senderId: session.user.id,
            senderName: session.user.name, recipientRole, content,
            contextType: String(payload.contextType ?? '').trim() || null,
            contextId: String(payload.contextId ?? '').trim() || null,
            contextLabel: String(payload.contextLabel ?? '').trim() || null,
            createdAt: new Date().toISOString(), readAt: null,
          };
          state.departmentMessages.push(created);
          appendNotification(state, {
            recipientRole, category: 'general', severity: 'info',
            title: `Nuevo mensaje de ${DEPARTMENT_LABELS[session.user.role]}`,
            description: content.length > 120 ? `${content.slice(0, 117)}…` : content,
            source: 'Chat departamental', metadata: { messageId: created.id, senderRole: session.user.role },
          });
          appendAudit(state, session, 'department_message_sent', created.id, recipientRole);
          return departmentMessageView(created);
        });
        return sendJson(res, 201, message);
      }

      const departmentMessageReadMatch = url.pathname.match(/^\/api\/internal-chat\/messages\/([^/]+)\/read$/);
      if (departmentMessageReadMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, DEPARTMENT_ROLES);
        const updated = await store.update(state => {
          ensureDepartmentMessages(state);
          const message = state.departmentMessages.find(item => item.id === departmentMessageReadMatch[1] && item.recipientRole === session.user.role);
          if (!message) throw Object.assign(new Error('El mensaje no existe o no pertenece al departamento.'), { statusCode: 404 });
          message.readAt ??= new Date().toISOString();
          return departmentMessageView(message);
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/occ/chat/conversations') {
        const state = await store.read();
        requireSession(state, req, ['ADMIN_OCC']);
        ensureChatCollections(state);
        return sendJson(res, 200, {
          station: { code: 'PUJ', localAbbr: 'AST' },
          conversations: state.chats.map(chat => chatConversationView(state, chat))
            .sort((left, right) => String(right.lastMessageAt).localeCompare(String(left.lastMessageAt))),
        });
      }

      const occChatMessagesMatch = url.pathname.match(/^\/api\/occ\/chat\/conversations\/([^/]+)\/messages$/);
      if (occChatMessagesMatch && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['ADMIN_OCC']);
        const chat = state.chats?.find(item => item.id === occChatMessagesMatch[1]);
        if (!chat) throw Object.assign(new Error('La conversación no existe.'), { statusCode: 404 });
        const messages = state.messages.filter(item => item.chatId === chat.id)
          .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
        return sendJson(res, 200, { conversationId: chat.id, messages: messages.map(chatMessageView) });
      }

      if (occChatMessagesMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['ADMIN_OCC']);
        const payload = await readJsonBody(req);
        const message = await store.update(state => {
          const chat = state.chats?.find(item => item.id === occChatMessagesMatch[1]);
          if (!chat) throw Object.assign(new Error('La conversación no existe.'), { statusCode: 404 });
          const created = appendChatMessage(state, chat, {
            senderId: session.user.id, senderRole: 'occ', senderName: session.user.name,
            content: payload.content, attachments: payload.attachments ?? [],
          });
          appendAudit(state, session, 'occ_chat_message_sent', chat.agentId, chat.id);
          return chatMessageView(created);
        });
        return sendJson(res, 201, message);
      }

      const occChatReadMatch = url.pathname.match(/^\/api\/occ\/chat\/conversations\/([^/]+)\/read$/);
      if (occChatReadMatch && req.method === 'POST') {
        const current = await store.read();
        requireSession(current, req, ['ADMIN_OCC']);
        const conversation = await store.update(state => {
          const chat = state.chats?.find(item => item.id === occChatReadMatch[1]);
          if (!chat) throw Object.assign(new Error('La conversación no existe.'), { statusCode: 404 });
          const readAt = new Date().toISOString();
          state.messages.filter(item => item.chatId === chat.id && item.senderRole === 'agent' && !item.readAt)
            .forEach(message => { message.readAt = readAt; });
          chat.requiresAttention = false;
          return chatConversationView(state, chat);
        });
        return sendJson(res, 200, conversation);
      }

      const occChatCloseMatch = url.pathname.match(/^\/api\/occ\/chat\/conversations\/([^/]+)\/close$/);
      if (occChatCloseMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['ADMIN_OCC']);
        const result = await store.update(state => {
          const chat = state.chats?.find(item => item.id === occChatCloseMatch[1]);
          if (!chat) throw Object.assign(new Error('La conversación no existe.'), { statusCode: 404 });
          chat.status = 'closed';
          chat.requiresAttention = false;
          const message = appendChatMessage(state, chat, {
            senderId: session.user.id, senderRole: 'system', senderName: 'Sistema',
            content: 'La conversación fue marcada como cerrada.',
          });
          appendAudit(state, session, 'occ_chat_closed', chat.agentId, chat.id);
          return { conversation: chatConversationView(state, chat), message: chatMessageView(message) };
        });
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && url.pathname === '/api/mobile/sync') {
        const current = await store.read();
        const session = requireSession(current, req, ['AGENTE_RAMPA']);
        const payload = await readJsonBody(req);
        const items = Array.isArray(payload.items) ? payload.items : [];
        const synchronizedAt = new Date().toISOString();
        const result = await store.update(state => {
          state.syncReceipts ??= [];
          const accepted = [];
          for (const item of [...items].sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')))) {
            if (!item?.idempotencyKey || state.syncReceipts.some(receipt => receipt.idempotencyKey === item.idempotencyKey)) continue;
            if (item.type === 'chat') {
              const chat = ensureAgentChat(state, session.user.personnelId);
              appendChatMessage(state, chat, {
                clientId: item.idempotencyKey, senderId: session.user.personnelId,
                senderRole: 'agent', senderName: session.user.name, content: item.payload?.text,
              });
              state.syncReceipts.push({ idempotencyKey: item.idempotencyKey, synchronizedAt });
              accepted.push(item.idempotencyKey);
              continue;
            }
            const flightId = item.payload?.flightId;
            const flight = state.flights.find(candidate => candidate.id === flightId && candidate.agentIds?.includes(session.user.personnelId));
            if (!flight) throw Object.assign(new Error('El vuelo no está asignado a este agente.'), { statusCode: 403 });
            let operation = state.operations.find(candidate => candidate.flightId === flightId);
            if (!operation) {
              operation = { id: nextId('REV'), flightId, agentId: session.user.personnelId, startedAt: null, endedAt: null, submittedAt: null, reviewStatus: null, checklist: null, history: [] };
              state.operations.unshift(operation);
            }
            if (item.type === 'operación') {
              if (item.payload.startedAt) operation.startedAt = item.payload.startedAt;
              if (item.payload.endedAt) {
                operation.endedAt = item.payload.endedAt;
                operation.submittedAt = synchronizedAt;
                operation.reviewStatus = 'PENDING_REVIEW';
                appendNotification(state, {
                  recipientRole: 'ADMIN_OCC', category: 'review', severity: 'info',
                  title: 'Nueva operación pendiente de revisión',
                  description: `El reporte del vuelo ${flight.flightNumber} fue sincronizado y requiere revisión.`,
                  source: 'Aplicación móvil', flight, operationId: operation.id,
                  relatedModule: 'approvals', relatedRoute: operation.id,
                });
                flight.operationStatus = 'completed';
              } else if (item.payload.startedAt) flight.operationStatus = 'in_progress';
              operation.history.push({ at: item.createdAt, action: item.payload.endedAt ? 'Operación completada' : 'Operación iniciada', user: session.user.name, fromStatus: null, toStatus: item.payload.endedAt ? 'PENDING_REVIEW' : null, comment: '' });
            }
            if (item.type === 'checklist') operation.checklist = { answers: item.payload.answers ?? {}, completedAt: item.payload.completedAt ?? synchronizedAt };
            if (item.type === 'incidencia') state.incidents.unshift({ id: nextId('INC'), flightId, agentId: session.user.personnelId, type: item.payload.type, impact: item.payload.impact, description: item.payload.description, imageUri: item.payload.imageUri ?? null, createdAt: item.createdAt, synchronizedAt });
            state.syncReceipts.push({ idempotencyKey: item.idempotencyKey, synchronizedAt });
            accepted.push(item.idempotencyKey);
          }
          appendAudit(state, session, 'mobile_sync_completed', session.user.personnelId, `${accepted.length} registros`);
          return { synchronizedAt, accepted, count: accepted.length };
        });
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' && url.pathname === '/api/occ/reviews') {
        const state = await store.read();
        requireSession(state, req, ['ADMIN_OCC']);
        return sendJson(res, 200, { station: { code: 'PUJ', localAbbr: 'AST' }, date: new Date().toISOString().slice(0, 10), operations: state.operations.filter(item => item.endedAt && item.checklist).map(item => reviewOperationView(state, item)) });
      }

      const reviewDetailMatch = url.pathname.match(/^\/api\/occ\/reviews\/([^/]+)$/);
      if (reviewDetailMatch && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['ADMIN_OCC']);
        const operation = state.operations.find(item => item.id === reviewDetailMatch[1] && item.endedAt && item.checklist);
        if (!operation) return sendJson(res, 404, { error: 'La operación de revisión no existe.' });
        return sendJson(res, 200, reviewOperationView(state, operation));
      }

      const reviewActionMatch = url.pathname.match(/^\/api\/occ\/reviews\/([^/]+)\/(start|approve|return)$/);
      if (reviewActionMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['ADMIN_OCC']);
        const payload = await readJsonBody(req);
        const [, operationId, action] = reviewActionMatch;
        const updated = await store.update(state => {
          const operation = state.operations.find(item => item.id === operationId);
          if (!operation) throw Object.assign(new Error('La operación no existe.'), { statusCode: 404 });
          if (action === 'return' && !String(payload.reason ?? '').trim()) throw Object.assign(new Error('El motivo de devolución es obligatorio.'), { statusCode: 400 });
          const previous = operation.reviewStatus;
          if (action === 'start') operation.reviewStatus = 'IN_REVIEW';
          if (action === 'approve') {
            operation.reviewStatus = 'APPROVED'; operation.approvedAt = new Date().toISOString();
            const flight = state.flights.find(item => item.id === operation.flightId);
            appendNotification(state, {
              recipientRole: 'FINANZAS', category: 'review', severity: 'success',
              title: 'Operación aprobada por OCC',
              description: `Los servicios del vuelo ${flight?.flightNumber ?? operation.id} están disponibles para revisión financiera.`,
              source: 'Revisión OCC', flight, operationId: operation.id,
              metadata: { operationId: operation.id },
            });
          }
          if (action === 'return') { operation.reviewStatus = 'RETURNED'; operation.returnReason = String(payload.reason).trim(); }
          operation.history.push({ at: new Date().toISOString(), action: action === 'approve' ? 'Operación aprobada' : action === 'return' ? 'Devuelto con correcciones' : 'Revisión iniciada', user: session.user.name, fromStatus: previous, toStatus: operation.reviewStatus, comment: operation.returnReason ?? payload.comment ?? '' });
          appendAudit(state, session, `review_${action}`, operation.id);
          return reviewOperationView(state, operation);
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/finance/approved-services') {
        const state = await store.read();
        requireSession(state, req, ['FINANZAS']);
        return sendJson(res, 200, approvedServiceRows(state));
      }

      const approvedServiceMatch = url.pathname.match(/^\/api\/finance\/approved-services\/(.+)\/review$/);
      if (approvedServiceMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['FINANZAS']);
        const rowId = decodeURIComponent(approvedServiceMatch[1]);
        const updated = await store.update(state => {
          const row = approvedServiceRows(state).find(item => item.id === rowId);
          if (!row) throw Object.assign(new Error('Servicio aprobado no encontrado.'), { statusCode: 404 });
          const operation = state.operations.find(item => item.id === row.operationId);
          operation.financeReviewedServiceIds ??= [];
          if (!operation.financeReviewedServiceIds.includes(row.serviceId)) operation.financeReviewedServiceIds.push(row.serviceId);
          appendAudit(state, session, 'approved_service_reviewed', rowId);
          return approvedServiceRows(state).find(item => item.id === rowId);
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/finance/preinvoices') {
        const state = await store.read();
        requireSession(state, req, ['FINANZAS']);
        return sendJson(res, 200, (state.preinvoices ?? []).map(preinvoiceView));
      }

      if (req.method === 'POST' && url.pathname === '/api/finance/preinvoices') {
        const current = await store.read();
        const session = requireSession(current, req, ['FINANZAS']);
        const payload = await readJsonBody(req);
        if (!String(payload.airline ?? '').trim() || !String(payload.period ?? '').trim()) {
          throw Object.assign(new Error('Aerolínea y período son obligatorios.'), { statusCode: 400 });
        }
        const created = await store.update(state => {
          state.preinvoices ??= [];
          const candidates = approvedServiceRows(state).filter(item => item.airline === String(payload.airline).trim());
          if (!candidates.length) throw Object.assign(new Error('La aerolínea no tiene servicios operativos aprobados.'), { statusCode: 409 });
          const currencies = [...new Set(candidates.map(item => item.currency))];
          if (currencies.length > 1) throw Object.assign(new Error('Los servicios con monedas distintas deben prefacturarse por separado.'), { statusCode: 409 });
          const preinvoice = {
            id: nextId('PRE'), airline: String(payload.airline).trim(), period: String(payload.period).trim(),
            serviceIds: candidates.map(item => item.id), total: candidates.reduce((sum, item) => sum + item.amount, 0),
            currency: currencies[0] ?? payload.currency ?? 'USD', status: 'draft', createdAt: new Date().toISOString(),
          };
          state.preinvoices.unshift(preinvoice);
          appendAudit(state, session, 'preinvoice_created', preinvoice.id);
          return preinvoiceView(preinvoice);
        });
        return sendJson(res, 201, created);
      }

      const preinvoiceActionMatch = url.pathname.match(/^\/api\/finance\/preinvoices\/([^/]+)\/(approve|send)$/);
      if (preinvoiceActionMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['FINANZAS']);
        const [, preinvoiceId, action] = preinvoiceActionMatch;
        const updated = await store.update(state => {
          const item = state.preinvoices.find(candidate => candidate.id === preinvoiceId);
          if (!item) throw Object.assign(new Error('Pre-factura no encontrada.'), { statusCode: 404 });
          if (action === 'send' && item.status !== 'approved') throw Object.assign(new Error('La pre-factura debe estar aprobada antes del envío.'), { statusCode: 409 });
          item.status = action === 'approve' ? 'approved' : 'sent';
          item[action === 'approve' ? 'approvedAt' : 'sentAt'] = new Date().toISOString();
          appendAudit(state, session, `preinvoice_${action}`, item.id);
          return preinvoiceView(item);
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/finance/summary') {
        const state = await store.read();
        requireSession(state, req, ['FINANZAS']);
        const rows = approvedServiceRows(state);
        const preinvoices = state.preinvoices ?? [];
        return sendJson(res, 200, {
          kpis: {
            approvedServices: rows.length,
            pendingReview: rows.filter(item => item.status === 'pending').length,
            draftPreinvoices: preinvoices.filter(item => item.status === 'draft').length,
            reconciliationDifferences: 0,
          },
          approvedServices: rows.slice(0, 6),
          pendingActions: preinvoices.filter(item => item.status !== 'sent').map(item => ({ id: item.id, kind: 'Pre-factura', airline: item.airline, detail: item.status === 'draft' ? 'Pendiente de revisión' : 'Aprobada para envío', moduleId: 'finance-preinvoices' })),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/finance/reports') {
        const state = await store.read();
        requireSession(state, req, ['FINANZAS']);
        return sendJson(res, 200, financeReportView(state));
      }

      if (req.method === 'GET' && url.pathname === '/api/reports/operational-records') {
        const state = await store.read();
        requireSession(state, req, ['ADMIN_OCC']);
        return sendJson(res, 200, { station: { code: 'PUJ' }, records: operationalReportRecords(state) });
      }

      if (req.method === 'POST' && url.pathname === '/api/finance/reports/export') {
        const current = await store.read();
        const session = requireSession(current, req, ['FINANZAS']);
        const payload = await readJsonBody(req);
        if (!['pdf', 'excel'].includes(payload.format)) {
          throw Object.assign(new Error('El formato debe ser PDF o Excel.'), { statusCode: 400 });
        }
        const result = await store.update(state => {
          const entry = appendAudit(state, session, 'finance_report_exported', session.user.id, payload.format);
          return {
            id: entry.id, format: payload.format, user: session.user.name, exportedAt: entry.occurredAt,
            fileName: `reporte-financiero-${new Date().toISOString().slice(0, 10)}.${payload.format === 'excel' ? 'xls' : 'pdf'}`,
            report: financeReportView(state),
          };
        });
        return sendJson(res, 201, result);
      }

      if (req.method === 'GET' && url.pathname === '/api/notifications') {
        const state = await store.read();
        const session = requireSession(state, req);
        const notifications = (state.notifications ?? [])
          .filter(item => item.recipientRole === session.user.role)
          .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
        return sendJson(res, 200, { station: { code: 'PUJ', localAbbr: 'AST' }, notifications });
      }

      const notificationReadMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/(read|unread)$/);
      if (notificationReadMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req);
        const [, notificationId, action] = notificationReadMatch;
        const updated = await store.update(state => {
          const item = (state.notifications ?? []).find(candidate => candidate.id === notificationId && candidate.recipientRole === session.user.role);
          if (!item) throw Object.assign(new Error('La notificación no existe.'), { statusCode: 404 });
          item.read = action === 'read';
          item.readAt = item.read ? new Date().toISOString() : null;
          return item;
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'POST' && url.pathname === '/api/notifications/read-all') {
        const current = await store.read();
        const session = requireSession(current, req);
        const updated = await store.update(state => {
          const now = new Date().toISOString();
          return (state.notifications ?? []).filter(item => item.recipientRole === session.user.role).map(item => {
            item.read = true;
            item.readAt = now;
            return item;
          });
        });
        return sendJson(res, 200, updated);
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/session') {
        const state = await store.read();
        const session = resolveSession(state.users, req.headers.authorization);
        if (!session) return sendJson(res, 401, { error: 'Sesión inválida o finalizada.' });
        return sendJson(res, 200, session);
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        closeSession(req.headers.authorization);
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/hr/ramp-agents' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA', 'ADMIN_OCC']);
        return sendJson(res, 200, state.personnel.filter(item => item.userType === 'ramp_agent').map(rampAgentView));
      }

      if (url.pathname === '/api/hr/equipment-types' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        return sendJson(res, 200, EQUIPMENT_TYPES);
      }

      if (url.pathname === '/api/hr/qualifications' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA', 'ADMIN_OCC']);
        ensureHumanResourcesCollections(state);
        const agentId = url.searchParams.get('agentId');
        return sendJson(res, 200, agentId ? state.qualifications.filter(item => item.agentId === agentId) : state.qualifications);
      }

      if (url.pathname === '/api/hr/qualifications' && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const created = await store.update(state => {
          ensureHumanResourcesCollections(state);
          const agent = state.personnel.find(item => item.identity.id === payload.agentId && item.userType === 'ramp_agent');
          const equipment = EQUIPMENT_TYPES.find(item => item.id === payload.equipmentId);
          if (!agent || !equipment || !payload.obtainedAt || !payload.expiresAt) {
            throw Object.assign(new Error('Agente, equipo y vigencia son obligatorios.'), { statusCode: 400 });
          }
          const view = rampAgentView(agent);
          const record = {
            id: nextId('QLF'), ...view, equipmentId: equipment.id, equipmentName: equipment.name,
            trainingDate: payload.trainingDate || payload.obtainedAt, obtainedAt: payload.obtainedAt,
            expiresAt: payload.expiresAt, certifyingEntity: payload.certifyingEntity || 'AVIAM',
            instructor: payload.instructor || '', notes: payload.notes || '',
            supportDocument: payload.supportDocument ?? null, updatedAt: new Date().toISOString(),
          };
          state.qualifications.unshift(record);
          state.qualificationHistory.unshift({
            id: nextId('QLH'), qualificationId: record.id, eventType: 'created',
            description: `Habilitación registrada para ${equipment.name}`,
            occurredAt: record.updatedAt, performedBy: session.user.name,
          });
          appendAudit(state, session, 'qualification_created', agent.identity.id, record.id);
          return record;
        });
        return sendJson(res, 201, created);
      }

      const qualificationMatch = url.pathname.match(/^\/api\/hr\/qualifications\/([^/]+)$/);
      if (qualificationMatch && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        ensureHumanResourcesCollections(state);
        const record = state.qualifications.find(item => item.id === qualificationMatch[1]);
        return record ? sendJson(res, 200, record) : sendJson(res, 404, { error: 'Habilitación no encontrada.' });
      }
      if (qualificationMatch && req.method === 'PATCH') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const updated = await store.update(state => {
          ensureHumanResourcesCollections(state);
          const record = state.qualifications.find(item => item.id === qualificationMatch[1]);
          if (!record) throw Object.assign(new Error('Habilitación no encontrada.'), { statusCode: 404 });
          Object.assign(record, payload, { id: record.id, agentId: record.agentId, updatedAt: new Date().toISOString() });
          appendAudit(state, session, 'qualification_updated', record.agentId, record.id);
          return record;
        });
        return sendJson(res, 200, updated);
      }

      const qualificationHistoryMatch = url.pathname.match(/^\/api\/hr\/qualifications\/([^/]+)\/history$/);
      if (qualificationHistoryMatch && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        ensureHumanResourcesCollections(state);
        return sendJson(res, 200, state.qualificationHistory.filter(item => item.qualificationId === qualificationHistoryMatch[1]));
      }

      const qualificationRenewMatch = url.pathname.match(/^\/api\/hr\/qualifications\/([^/]+)\/renew$/);
      if (qualificationRenewMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const updated = await store.update(state => {
          ensureHumanResourcesCollections(state);
          const record = state.qualifications.find(item => item.id === qualificationRenewMatch[1]);
          if (!record) throw Object.assign(new Error('Habilitación no encontrada.'), { statusCode: 404 });
          Object.assign(record, payload, { id: record.id, agentId: record.agentId, updatedAt: new Date().toISOString() });
          state.qualificationHistory.unshift({
            id: nextId('QLH'), qualificationId: record.id, eventType: 'renewed',
            description: 'Habilitación renovada', occurredAt: record.updatedAt, performedBy: session.user.name,
          });
          appendAudit(state, session, 'qualification_renewed', record.agentId, record.id);
          return record;
        });
        return sendJson(res, 200, updated);
      }

      if (url.pathname === '/api/hr/permits' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA', 'ADMIN_OCC']);
        ensureHumanResourcesCollections(state);
        const agentId = url.searchParams.get('agentId');
        return sendJson(res, 200, agentId ? state.permits.filter(item => item.agentId === agentId) : state.permits);
      }

      const permitHistoryMatch = url.pathname.match(/^\/api\/hr\/permits\/([^/]+)\/history$/);
      if (permitHistoryMatch && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        ensureHumanResourcesCollections(state);
        return sendJson(res, 200, state.permitHistory.filter(item => item.permitId === permitHistoryMatch[1]));
      }

      const permitRenewMatch = url.pathname.match(/^\/api\/hr\/permits\/([^/]+)\/renew$/);
      if (permitRenewMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const updated = await store.update(state => {
          ensureHumanResourcesCollections(state);
          const record = state.permits.find(item => item.id === permitRenewMatch[1]);
          if (!record) throw Object.assign(new Error('Documento aeroportuario no encontrado.'), { statusCode: 404 });
          Object.assign(record, payload, { id: record.id, agentId: record.agentId, updatedAt: new Date().toISOString() });
          state.permitHistory.unshift({
            id: nextId('PMH'), permitId: record.id, documentType: record.type, eventType: 'renewed',
            description: `${record.type === 'carnet' ? 'Carnet' : 'Licencia'} renovado`,
            occurredAt: record.updatedAt, performedBy: session.user.name,
          });
          appendAudit(state, session, 'permit_renewed', record.agentId, record.id);
          return record;
        });
        return sendJson(res, 200, updated);
      }

      if (url.pathname === '/api/hr/schedules/positions' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        return sendJson(res, 200, HR_POSITIONS);
      }
      if (url.pathname === '/api/hr/schedules/shift-blocks' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        return sendJson(res, 200, SHIFT_BLOCKS);
      }
      if (url.pathname === '/api/hr/schedules/coverage-requirements' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        return sendJson(res, 200, []);
      }
      if (url.pathname === '/api/hr/schedules/shifts' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA', 'ADMIN_OCC']);
        ensureHumanResourcesCollections(state);
        return sendJson(res, 200, state.shifts);
      }
      if (url.pathname === '/api/hr/schedules/shifts' && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const saved = await store.update(state => {
          ensureHumanResourcesCollections(state);
          const agent = state.personnel.find(item => item.identity.id === payload.agentId && item.userType === 'ramp_agent');
          if (!agent || !payload.date || !payload.startTime || !payload.endTime || !payload.terminal) {
            throw Object.assign(new Error('Faltan datos obligatorios del turno.'), { statusCode: 400 });
          }
          const index = payload.id
            ? state.shifts.findIndex(item => item.id === payload.id)
            : state.shifts.findIndex(item => item.agentId === payload.agentId && item.date === payload.date);
          const block = SHIFT_BLOCKS.find(item => item.startTime === payload.startTime && item.endTime === payload.endTime)?.id ?? 'morning';
          const now = new Date().toISOString();
          const record = {
            id: index >= 0 ? state.shifts[index].id : nextId('SHF'), agentId: agent.identity.id,
            agentName: rampAgentView(agent).agentName, date: payload.date, startTime: payload.startTime,
            endTime: payload.endTime, block, terminal: payload.terminal,
            positionId: payload.positionId ?? null, createdAt: index >= 0 ? state.shifts[index].createdAt : now, updatedAt: now,
          };
          if (index >= 0) state.shifts[index] = record; else state.shifts.push(record);
          appendAudit(state, session, 'shift_saved', agent.identity.id, record.id);
          return record;
        });
        return sendJson(res, 200, saved);
      }

      const shiftMatch = url.pathname.match(/^\/api\/hr\/schedules\/shifts\/([^/]+)$/);
      if (shiftMatch && req.method === 'DELETE') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        await store.update(state => {
          ensureHumanResourcesCollections(state);
          const record = state.shifts.find(item => item.id === shiftMatch[1]);
          state.shifts = state.shifts.filter(item => item.id !== shiftMatch[1]);
          appendAudit(state, session, 'shift_deleted', record?.agentId ?? null, shiftMatch[1]);
        });
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === '/api/hr/schedules/availability-requests' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        ensureHumanResourcesCollections(state);
        return sendJson(res, 200, state.availabilityRequests);
      }

      const availabilityMatch = url.pathname.match(/^\/api\/hr\/schedules\/availability-requests\/([^/]+)\/resolve$/);
      if (availabilityMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const updated = await store.update(state => {
          ensureHumanResourcesCollections(state);
          const record = state.availabilityRequests.find(item => item.id === availabilityMatch[1]);
          if (!record) throw Object.assign(new Error('Solicitud de disponibilidad no encontrada.'), { statusCode: 404 });
          record.status = payload.status;
          record.resolvedAt = new Date().toISOString();
          record.resolvedBy = session.user.name;
          return record;
        });
        return sendJson(res, 200, updated);
      }

      if (url.pathname === '/api/hr/roles' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        return sendJson(res, 200, [
          'role-admin-occ', 'role-analista-occ', 'role-contratos', 'role-finanzas',
          'role-rrhh-admin', 'role-rrhh-generalista', 'role-agente-rampa', 'role-usuario-aerolinea',
        ].map(roleDefinition));
      }

      if (url.pathname === '/api/hr/users' && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        return sendJson(res, 200, state.personnel);
      }

      if (url.pathname === '/api/hr/users' && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const email = String(payload.identity?.email ?? '').trim().toLowerCase();
        const role = roleDefinition(payload.access?.roleId);
        if (!email || !payload.identity?.firstName || !payload.identity?.lastName || !role) {
          throw Object.assign(new Error('Faltan datos obligatorios del usuario.'), { statusCode: 400 });
        }
        if (current.personnel.some(item => item.identity.email.toLowerCase() === email) || current.users.some(item => item.email.toLowerCase() === email)) {
          throw Object.assign(new Error('Ya existe una cuenta con ese correo.'), { statusCode: 409 });
        }

        const record = await store.update(state => {
          const now = new Date().toISOString();
          const id = nextId('PER');
          const created = {
            identity: { id, avatarUrl: null, ...payload.identity, email },
            account: {
              id: nextId('ACC'), userId: id, status: 'active', createdAt: now,
              lastLoginAt: null, invitationStatus: 'accepted', invitationSentAt: now,
            },
            access: { portal: role.portal, roleId: role.id, roleName: role.name, permissions: role.permissions },
            userType: payload.userType,
            ...(payload.backOffice ? { backOffice: payload.backOffice } : {}),
            ...(payload.rampAgent ? { rampAgent: payload.rampAgent } : {}),
            ...(payload.airlineClient ? { airlineClient: payload.airlineClient } : {}),
          };
          state.personnel.unshift(created);
          ensureHumanResourcesCollections(state);
          if (created.userType === 'ramp_agent') {
            const agent = rampAgentView(created);
            const issuedAt = created.rampAgent?.hireDate || now.slice(0, 10);
            const expiresAt = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
            for (const type of ['carnet', 'licencia']) {
              const permit = {
                id: `${id}-${type}`, ...agent, type, number: '',
                issuedAt, expiresAt, supportDocument: null, updatedAt: now,
              };
              state.permits.push(permit);
              state.permitHistory.push({
                id: nextId('PMH'), permitId: permit.id, documentType: type, eventType: 'issued',
                description: `${type === 'carnet' ? 'Carnet aeroportuario' : 'Licencia de conducir en rampa'} pendiente de registro`,
                occurredAt: now, performedBy: session.user.name,
              });
            }
          }
          syncMobileAccount(state, created);
          appendAudit(state, session, 'account_created', id);
          return created;
        });
        return sendJson(res, 201, record);
      }

      const personnelMatch = url.pathname.match(/^\/api\/hr\/users\/([^/]+)$/);
      if (personnelMatch && req.method === 'PATCH') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const payload = await readJsonBody(req);
        const updated = await store.update(state => {
          const record = findPersonnel(state, personnelMatch[1]);
          if (payload.identity) record.identity = { ...record.identity, ...payload.identity };
          if (payload.backOffice) record.backOffice = { ...record.backOffice, ...payload.backOffice };
          if (payload.rampAgent) record.rampAgent = { ...record.rampAgent, ...payload.rampAgent };
          if (payload.airlineClient) record.airlineClient = { ...record.airlineClient, ...payload.airlineClient };
          const role = payload.access?.roleId ? roleDefinition(payload.access.roleId) : null;
          if (role) record.access = { portal: role.portal, roleId: role.id, roleName: role.name, permissions: role.permissions };
          syncMobileAccount(state, record);
          appendAudit(state, session, 'account_updated', record.identity.id);
          return record;
        });
        return sendJson(res, 200, updated);
      }

      const accountActionMatch = url.pathname.match(/^\/api\/hr\/users\/([^/]+)\/(activate|deactivate|reset-access|resend-invitation)$/);
      if (accountActionMatch && req.method === 'POST') {
        const current = await store.read();
        const session = requireSession(current, req, ['GESTION_HUMANA']);
        const body = await readJsonBody(req);
        const [, personnelId, action] = accountActionMatch;
        const updated = await store.update(state => {
          const record = findPersonnel(state, personnelId);
          if (action === 'activate') record.account.status = 'active';
          if (action === 'deactivate') record.account.status = 'disabled';
          if (action === 'resend-invitation') record.account.invitationSentAt = new Date().toISOString();
          const mobileUser = state.users.find(item => item.personnelId === personnelId);
          if (action === 'reset-access' && mobileUser) mobileUser.password = 'Elevant2026!';
          syncMobileAccount(state, record);
          appendAudit(state, session, `account_${action}`, personnelId, body.reason);
          return record;
        });
        return sendJson(res, 200, updated);
      }

      const historyMatch = url.pathname.match(/^\/api\/hr\/users\/([^/]+)\/history$/);
      if (historyMatch && req.method === 'GET') {
        const state = await store.read();
        requireSession(state, req, ['GESTION_HUMANA']);
        return sendJson(res, 200, state.audit.filter(item => item.affectedUserId === historyMatch[1]));
      }

      return sendJson(res, 404, { error: 'Ruta no encontrada.' });
    } catch (error) {
      console.error(error);
      return sendJson(res, error.statusCode ?? 500, {
        error: error.statusCode ? error.message : 'Error interno del prototipo.',
      });
    }
  });
}
