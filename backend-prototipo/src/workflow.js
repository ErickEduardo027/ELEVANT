const now = () => new Date().toISOString();
const makeId = prefix => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const find = (items, id, label) => items.find(item => item.id === id) || fail(`${label} no encontrado.`, 404);
const event = (data, type, entityId, user, details = {}) => data.audit.unshift({ id: makeId('AUD'), type, entityId, actorId: user?.id || 'SYSTEM', actorName: user?.name || 'Sistema', occurredAt: now(), details });
const notify = (data, roles, title, message, entityId) => roles.forEach(role => data.notifications.unshift({ id: makeId('NOT'), role, title, message, entityId, createdAt: now(), readAt: null }));

export function submitRequest(data, payload, actor = { id: payload.requestedBy || 'AIRLINE', name: payload.airline || 'Aerolínea' }) {
  if (!payload.airlineId || !payload.title || !payload.description) fail('Aerolínea, título y descripción son obligatorios.');
  let airline = data.airlines.find(item => item.id === payload.airlineId);
  if (!airline) {
    airline = { id: payload.airlineId, name: payload.airline || 'Aerolínea solicitante', code: payload.airlineCode || 'NEW', contactEmail: payload.contactEmail || '', status: 'prospect' };
    data.airlines.push(airline);
  }
  const record = { id: makeId('SOL'), airlineId: airline.id, airline: airline.name, station: payload.station || 'PUJ', flightId: payload.flightId || null, type: payload.type || 'ADDITIONAL_SERVICE', title: payload.title.trim(), description: payload.description.trim(), requestedServices: payload.requestedServices || [], requestedFor: payload.requestedFor || now(), status: 'SUBMITTED', createdAt: now(), updatedAt: now(), decisionNote: null };
  data.serviceRequests.unshift(record); notify(data, ['CONTRATOS'], 'Nueva solicitud de aerolínea', `${airline.name}: ${record.title}`, record.id); event(data, 'REQUEST_SUBMITTED', record.id, actor); return record;
}

export function reviewRequest(data, requestId, user) {
  const record = find(data.serviceRequests, requestId, 'Solicitud');
  if (record.status !== 'SUBMITTED') fail('Solo una solicitud recibida puede pasar a revisión.');
  record.status = 'IN_REVIEW'; record.updatedAt = now(); event(data, 'REQUEST_IN_REVIEW', record.id, user); return record;
}

export function decideRequest(data, requestId, payload, user) {
  const request = find(data.serviceRequests, requestId, 'Solicitud');
  if (!['SUBMITTED', 'IN_REVIEW'].includes(request.status)) fail('La solicitud ya fue atendida.');
  if (!['APPROVED', 'REJECTED'].includes(payload.status)) fail('Decisión inválida.');
  if (!String(payload.decisionNote || '').trim()) fail('Debe registrar una observación.');
  request.status = payload.status; request.decisionNote = payload.decisionNote.trim(); request.updatedAt = now(); request.notifiedAt = now();
  let contract = null;
  if (payload.status === 'APPROVED') {
    contract = { id: makeId('CTR'), airlineId: request.airlineId, airline: request.airline, airlineCode: data.airlines.find(item => item.id === request.airlineId)?.code || '', type: payload.contractType || 'TEMPORARY', startDate: payload.startDate || now().slice(0, 10), endDate: payload.endDate || null, status: 'ACTIVE', conditions: payload.conditions || request.description, sourceRequestId: request.id, createdAt: now() };
    data.contracts.unshift(contract);
    const requested = payload.services?.length ? payload.services : request.requestedServices;
    for (const service of requested || []) data.contractServices.push({ id: makeId('SVC'), contractId: contract.id, code: service.code || String(service).toUpperCase().replaceAll(' ', '_'), name: service.name || String(service), unit: service.unit || 'SERVICE', unitPrice: Number(service.unitPrice || payload.defaultRate || 0), currency: service.currency || payload.currency || 'USD', active: true });
    for (const flight of data.flights.filter(item => item.airlineId === contract.airlineId && !item.contractId)) flight.contractId = contract.id;
    notify(data, ['FINANZAS', 'ADMIN_OCC'], 'Contrato activado', `${contract.airline} ya dispone de contrato ${contract.id}.`, contract.id);
  }
  event(data, `REQUEST_${payload.status}`, request.id, user, { contractId: contract?.id || null }); return { request, contract };
}

export function allocatePersonnel(data, payload, user) {
  const agent = find(data.personnel, payload.agentId, 'Agente');
  if (!agent.available || agent.status !== 'active') fail('El agente no está disponible.');
  const record = { id: makeId('HRA'), agentId: agent.id, agentName: agent.name, station: payload.station || 'PUJ', date: payload.date || now().slice(0, 10), shift: payload.shift || agent.shift, status: 'AVAILABLE_FOR_OCC', allocatedAt: now(), allocatedBy: user.id };
  data.hrAllocations.unshift(record); notify(data, ['ADMIN_OCC'], 'Personal disponible', `${agent.name} fue habilitado para planificación OCC.`, record.id); event(data, 'PERSONNEL_ALLOCATED', record.id, user); return record;
}

export function assignFlight(data, flightId, payload, user) {
  const flight = find(data.flights, flightId, 'Vuelo');
  const contract = data.contracts.find(item => item.id === flight.contractId && item.status === 'ACTIVE');
  if (!contract) fail('El vuelo no posee un contrato activo.');
  const allocation = data.hrAllocations.find(item => item.agentId === payload.agentId && item.status === 'AVAILABLE_FOR_OCC');
  if (!allocation) fail('Gestión Humana no ha habilitado este agente para OCC.');
  const agent = find(data.personnel, payload.agentId, 'Agente');
  const services = payload.services || data.contractServices.filter(item => item.contractId === contract.id && item.active).map(item => item.name);
  if (!services.length) fail('Debe asignar al menos un servicio.');
  const missing = services.filter(service => !agent.qualifications.includes(service));
  if (missing.length) fail(`El agente no está habilitado para: ${missing.join(', ')}.`);
  const record = { id: makeId('ASG'), flightId, agentId: agent.id, agentName: agent.name, services, gate: payload.gate || flight.gate, status: 'ASSIGNED', assignedAt: now(), assignedBy: user.id };
  data.assignments.unshift(record); allocation.status = 'ASSIGNED'; flight.operationStatus = 'ASSIGNED';
  notify(data, ['AGENTE_RAMPA'], 'Nueva asignación', `${flight.number} · ${services.join(', ')}`, record.id); event(data, 'FLIGHT_ASSIGNED', record.id, user); return record;
}

export function startOperation(data, flightId, payload, user) {
  const flight = find(data.flights, flightId, 'Vuelo');
  const assignment = data.assignments.find(item => item.flightId === flightId && item.status === 'ASSIGNED');
  if (!assignment) fail('El vuelo no tiene una asignación activa.');
  if (!['ARRIVED', 'LANDED_TAXIING', 'ARRIVED_GATE'].includes(flight.flightStatus)) fail('El estado del vuelo no permite iniciar atención.');
  if (data.operations.some(item => item.flightId === flightId && item.status === 'IN_PROGRESS')) fail('La atención ya está iniciada.');
  const record = { id: makeId('OPE'), flightId, assignmentId: assignment.id, airlineId: flight.airlineId, agentId: assignment.agentId, services: assignment.services.map(name => ({ name, status: 'PENDING' })), checklist: {}, status: 'IN_PROGRESS', startedAt: payload.startedAt || now(), completedAt: null, synchronizedAt: null };
  data.operations.unshift(record); flight.operationStatus = 'IN_PROGRESS'; assignment.status = 'IN_PROGRESS'; event(data, 'OPERATION_STARTED', record.id, user); return record;
}

export function completeOperation(data, operationId, payload, user) {
  const operation = find(data.operations, operationId, 'Operación');
  if (operation.status !== 'IN_PROGRESS') fail('La operación no está en atención.');
  const checklist = payload.checklist || {};
  if (!Object.keys(checklist).length || Object.values(checklist).some(value => value === null || value === undefined || value === '')) fail('El checklist debe estar completo.');
  operation.checklist = checklist; operation.status = 'PENDING_REVIEW'; operation.completedAt = payload.completedAt || now(); operation.synchronizedAt = now();
  operation.services = operation.services.map(service => ({ ...service, status: 'COMPLETED' }));
  const flight = find(data.flights, operation.flightId, 'Vuelo'); flight.operationStatus = 'PENDING_REVIEW';
  notify(data, ['ADMIN_OCC'], 'Operación pendiente de revisión', `${flight.number} fue completado por el agente.`, operation.id); event(data, 'OPERATION_COMPLETED', operation.id, user); return operation;
}

export function addIncident(data, payload, user) {
  const flight = find(data.flights, payload.flightId, 'Vuelo');
  const record = { id: makeId('INC'), flightId: flight.id, operationId: payload.operationId || null, description: String(payload.description || '').trim(), type: payload.type || 'OPERATIVE', impact: payload.impact || 'MEDIUM', area: payload.area || 'RAMP', evidence: payload.evidence || [], status: 'REPORTED', reportedAt: now(), reportedBy: user.id };
  if (!record.description) fail('La descripción es obligatoria.');
  data.incidents.unshift(record); notify(data, ['ADMIN_OCC'], 'Nueva incidencia', `${flight.number}: ${record.description}`, record.id); event(data, 'INCIDENT_REPORTED', record.id, user); return record;
}

export function reviewOperation(data, operationId, payload, user) {
  const operation = find(data.operations, operationId, 'Operación');
  if (operation.status !== 'PENDING_REVIEW') fail('La operación no está pendiente de revisión.');
  if (!['APPROVED', 'RETURNED'].includes(payload.status)) fail('Resultado de revisión inválido.');
  const review = { id: makeId('REV'), operationId, status: payload.status, note: payload.note || '', reviewedAt: now(), reviewedBy: user.id };
  data.reviews.unshift(review); operation.status = payload.status === 'APPROVED' ? 'APPROVED' : 'RETURNED';
  const flight = find(data.flights, operation.flightId, 'Vuelo'); flight.operationStatus = operation.status;
  if (payload.status === 'APPROVED') {
    const contract = find(data.contracts, flight.contractId, 'Contrato');
    for (const service of operation.services) {
      const rate = data.contractServices.find(item => item.contractId === contract.id && item.name === service.name);
      data.executedServices.push({ id: makeId('EXE'), operationId, flightId: flight.id, airlineId: flight.airlineId, airline: flight.airline, flight: flight.number, service: service.name, contractId: contract.id, amount: Number(rate?.unitPrice || 0), currency: rate?.currency || 'USD', status: 'APPROVED', executedAt: operation.completedAt });
    }
    notify(data, ['FINANZAS'], 'Servicios aprobados', `${flight.number} está disponible para pre-facturación.`, operation.id);
  } else notify(data, ['AGENTE_RAMPA'], 'Operación devuelta', payload.note || 'OCC solicitó correcciones.', operation.id);
  event(data, `OPERATION_${payload.status}`, operation.id, user); return { operation, review };
}

export function generatePreinvoice(data, payload, user) {
  const services = data.executedServices.filter(item => item.airlineId === payload.airlineId && item.status === 'APPROVED' && !item.preinvoiceId);
  if (!services.length) fail('No hay servicios aprobados pendientes para esta aerolínea.');
  const currency = payload.currency || services[0].currency;
  const selected = services.filter(item => item.currency === currency);
  const record = { id: makeId('PRE'), airlineId: payload.airlineId, airline: selected[0].airline, period: payload.period || now().slice(0, 7), serviceIds: selected.map(item => item.id), services: selected.length, subtotal: selected.reduce((sum, item) => sum + Number(item.amount), 0), tax: 0, total: selected.reduce((sum, item) => sum + Number(item.amount), 0), currency, status: 'DRAFT', createdAt: now(), createdBy: user.id };
  data.preinvoices.unshift(record); selected.forEach(item => { item.preinvoiceId = record.id; }); event(data, 'PREINVOICE_CREATED', record.id, user); return record;
}

export function transitionPreinvoice(data, id, action, user) {
  const record = find(data.preinvoices, id, 'Pre-factura');
  const next = action === 'approve' && record.status === 'DRAFT' ? 'APPROVED' : action === 'send' && record.status === 'APPROVED' ? 'SENT' : null;
  if (!next) fail(`No se puede ${action === 'approve' ? 'aprobar' : 'enviar'} una pre-factura en estado ${record.status}.`);
  record.status = next; record[`${next.toLowerCase()}At`] = now();
  if (next === 'SENT') notify(data, ['AIRLINE'], 'Pre-factura disponible', `${record.id} fue enviada para revisión.`, record.id);
  event(data, `PREINVOICE_${next}`, record.id, user); return record;
}

export function createChat(data, payload, user) {
  const participants = [...new Set([user.role, ...(payload.participants || [])])];
  if (participants.length < 2) fail('Seleccione otro departamento.');
  const existing = data.chats.find(item => [...item.participants].sort().join('|') === [...participants].sort().join('|') && item.contextId === (payload.contextId || null));
  if (existing) return existing;
  const record = { id: makeId('CHAT'), title: payload.title || participants.join(' · '), participants, contextId: payload.contextId || null, status: 'ACTIVE', createdAt: now(), createdBy: user.id };
  data.chats.unshift(record); return record;
}

export function sendMessage(data, chatId, payload, user) {
  const chat = find(data.chats, chatId, 'Conversación');
  if (!chat.participants.includes(user.role)) fail('No pertenece a esta conversación.', 403);
  const text = String(payload.text || '').trim(); if (!text) fail('El mensaje no puede estar vacío.');
  const record = { id: makeId('MSG'), chatId, text, senderId: user.id, senderName: user.name, senderRole: user.role, sentAt: now(), readBy: [user.id] };
  data.messages.push(record); return record;
}

export function synchronizeMobile(data, items, user) {
  if (user.role !== 'AGENTE_RAMPA') fail('Solo un agente de rampa puede sincronizar esta cola.', 403);
  const ordered = [...(items || [])].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const checklists = new Map();
  const results = [];
  for (const item of ordered) {
    if (data.mobileSyncRecords?.some(record => record.idempotencyKey === item.idempotencyKey)) continue;
    const payload = item.payload || {};
    if (item.type === 'checklist') checklists.set(payload.flightId, payload.answers || {});
    if (item.type === 'operación' && payload.flightId) {
      let operation = data.operations.find(record => record.flightId === payload.flightId && ['IN_PROGRESS', 'PENDING_REVIEW'].includes(record.status));
      if (payload.startedAt && !operation) operation = startOperation(data, payload.flightId, { startedAt: payload.startedAt }, user);
      if (payload.endedAt && operation?.status === 'IN_PROGRESS') operation = completeOperation(data, operation.id, { completedAt: payload.endedAt, checklist: checklists.get(payload.flightId) || payload.checklist || {} }, user);
      results.push(operation);
    } else if (item.type === 'incidencia') {
      results.push(addIncident(data, { ...payload, evidence: payload.imageUri ? [payload.imageUri] : [] }, user));
    } else if (item.type === 'chat') {
      const chat = createChat(data, { title: 'Agente de rampa · OCC', participants: ['ADMIN_OCC'] }, user);
      results.push(sendMessage(data, chat.id, { text: payload.text }, user));
    }
    data.mobileSyncRecords ||= [];
    data.mobileSyncRecords.push({ id: makeId('MOB'), idempotencyKey: item.idempotencyKey, type: item.type, synchronizedAt: now(), userId: user.id });
  }
  return { synchronizedAt: now(), count: ordered.length, results };
}

export function summary(data) {
  return { requests: data.serviceRequests.length, activeContracts: data.contracts.filter(item => item.status === 'ACTIVE').length, availablePersonnel: data.hrAllocations.filter(item => item.status === 'AVAILABLE_FOR_OCC').length, assignedFlights: data.assignments.length, operationsPendingReview: data.operations.filter(item => item.status === 'PENDING_REVIEW').length, approvedServices: data.executedServices.filter(item => item.status === 'APPROVED').length, preinvoices: data.preinvoices.length, openIncidents: data.incidents.filter(item => item.status !== 'CLOSED').length };
}
