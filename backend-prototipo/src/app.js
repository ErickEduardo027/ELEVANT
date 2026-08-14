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

function ensureChatCollections(state) {
  state.chats ??= [];
  state.messages ??= [];
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
          const request = {
            id: nextId('SOL'), airline, contactName, contactEmail, type, requestedService,
            receivedAt: new Date().toISOString(), status: 'pending', decisionNote: '', notifiedAt: null,
            details: payload.details ?? null,
          };
          state.serviceRequests.unshift(request);
          return request;
        });
        return sendJson(res, 201, created);
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
        const contracts = state.contracts.filter(contract => isOperationalContract(contract));
        const agents = state.personnel
          .filter(record => record.userType === 'ramp_agent' && record.account.status === 'active')
          .map(record => ({ id: record.identity.id, name: `${record.identity.firstName} ${record.identity.lastName}`.trim(), terminals: record.rampAgent?.terminals ?? [] }));
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
          const agent = state.personnel.find(record => record.identity.id === payload.agentId && record.userType === 'ramp_agent' && record.account.status === 'active');
          if (!agent) throw Object.assign(new Error('El agente no está habilitado.'), { statusCode: 409 });
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
          if (action === 'approve') { operation.reviewStatus = 'APPROVED'; operation.approvedAt = new Date().toISOString(); }
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
