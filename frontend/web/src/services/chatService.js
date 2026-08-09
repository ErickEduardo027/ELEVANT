// Adaptador mock del módulo Chat interno. Sustituir por llamadas HTTP/WebSocket reales cuando exista backend.
//
// Endpoints conceptuales que este adaptador representa (ver Claude-skills/plan-chat/skill.md):
//   GET  /chat/conversations
//   GET  /chat/conversations/{id}/messages
//   POST /chat/conversations/{id}/messages         { content, attachments }
//   POST /chat/conversations/{id}/read
//   POST /chat/conversations/{id}/close
//   POST /chat/conversations                       { flightId, operationId, agentId }
//   GET  /chat/available-flights
//   WebSocket (o polling): nuevos mensajes / cambios de presencia del agente
//
// El store en memoria (CONVERSATION_TEMPLATES + MESSAGES_BY_CONVERSATION) simula la respuesta de
// esos endpoints con datos realistas; `subscribeToConversationUpdates` simula el canal en tiempo real.

// PUJ / Atlantic Standard Time — mismo criterio que reviewService.js/notificationsService.js.
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
const older = getStationDate(6);

const CONVERSATION_TEMPLATES = [
  {
    id: 'CHAT-4001',
    flightId: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    origin: 'MIA',
    destination: 'PUJ',
    position: 'A5',
    operationId: 'REV-1001',
    agentId: 12,
    agentName: 'Carlos Medina',
    agentStatus: 'online',
    agentLastSeenAt: null,
    status: 'active',
    requiresAttention: true,
  },
  {
    id: 'CHAT-4002',
    flightId: 2,
    flightNumber: 'AA904',
    airline: 'American Airlines',
    origin: 'MIA',
    destination: 'PUJ',
    position: 'B21',
    operationId: 'REV-1002',
    agentId: 8,
    agentName: 'María Castillo',
    agentStatus: 'offline',
    agentLastSeenAt: isoAt(today, 10, 56),
    status: 'pending',
    requiresAttention: false,
  },
  {
    id: 'CHAT-4003',
    flightId: 7,
    flightNumber: 'CM345',
    airline: 'Copa Airlines',
    origin: 'PTY',
    destination: 'PUJ',
    position: 'BN8',
    operationId: 'REV-1009',
    agentId: 3,
    agentName: 'Rafael Peña',
    agentStatus: 'online',
    agentLastSeenAt: null,
    status: 'active',
    requiresAttention: false,
  },
  {
    id: 'CHAT-4004',
    flightId: 9,
    flightNumber: 'B6812',
    airline: 'JetBlue',
    origin: 'PUJ',
    destination: 'BOS',
    position: 'A1',
    operationId: 'REV-1006',
    agentId: 14,
    agentName: 'José Fermín',
    agentStatus: 'offline',
    agentLastSeenAt: isoAt(yesterday, 14, 30),
    status: 'closed',
    requiresAttention: false,
  },
  {
    id: 'CHAT-4005',
    flightId: 3,
    flightNumber: 'DL2210',
    airline: 'Delta Air Lines',
    origin: 'ATL',
    destination: 'PUJ',
    position: 'B21',
    operationId: 'REV-1003',
    agentId: 9,
    agentName: 'Katherine Objío',
    agentStatus: 'online',
    agentLastSeenAt: null,
    status: 'active',
    requiresAttention: true,
  },
  {
    id: 'CHAT-4006',
    flightId: 5,
    flightNumber: 'UA1470',
    airline: 'United Airlines',
    origin: 'PUJ',
    destination: 'EWR',
    position: 'A1',
    operationId: 'REV-1005',
    agentId: 12,
    agentName: 'Carlos Medina',
    agentStatus: null,
    agentLastSeenAt: null,
    status: 'pending',
    requiresAttention: false,
  },
];

// AVAILABLE_FLIGHT_TEMPLATES: vuelos/operaciones que todavía no tienen conversación abierta.
// Se ofrecen como opciones en "Nueva conversación"; una vez creada la conversación desaparecen
// de la lista disponible (ver getAvailableFlightsForNewConversation).
const AVAILABLE_FLIGHT_TEMPLATES = [
  {
    flightId: 6,
    flightNumber: 'AC1876',
    airline: 'Air Canada',
    origin: 'PUJ',
    destination: 'YYZ',
    position: 'A5',
    operationId: 'REV-1004',
    agentId: 12,
    agentName: 'Carlos Medina',
  },
  {
    flightId: 8,
    flightNumber: 'WG654',
    airline: 'Sunwing',
    origin: 'PUJ',
    destination: 'YYZ',
    position: 'B32',
    operationId: 'REV-1010',
    agentId: 8,
    agentName: 'María Castillo',
  },
  {
    flightId: 12,
    flightNumber: 'TS234',
    airline: 'Air Transat',
    origin: 'PUJ',
    destination: 'YUL',
    position: 'A1',
    operationId: 'REV-1011',
    agentId: 3,
    agentName: 'Rafael Peña',
  },
];

function systemMessage(id, conversationId, createdAt, content) {
  return {
    id,
    conversationId,
    type: 'system',
    senderId: null,
    senderRole: 'system',
    senderName: 'Sistema',
    content,
    createdAt,
    readAt: createdAt,
    status: 'delivered',
    attachments: [],
  };
}

function agentMessage(id, conversationId, createdAt, content, { readAt = null, attachments = [] } = {}) {
  const template = CONVERSATION_TEMPLATES.find(c => c.id === conversationId);
  return {
    id,
    conversationId,
    type: 'message',
    senderId: template?.agentId ?? null,
    senderRole: 'agent',
    senderName: template?.agentName ?? 'Agente',
    content,
    createdAt,
    readAt,
    status: 'delivered',
    attachments,
  };
}

function occMessage(id, conversationId, createdAt, content, { status = 'sent', attachments = [] } = {}) {
  return {
    id,
    conversationId,
    type: 'message',
    senderId: 'occ-current-user',
    senderRole: 'occ',
    senderName: 'Administrador OCC',
    content,
    createdAt,
    readAt: null,
    status,
    attachments,
  };
}

const MESSAGES_BY_CONVERSATION = {
  'CHAT-4001': [
    systemMessage('MSG-4001-1', 'CHAT-4001', isoAt(today, 8, 10), 'El agente Carlos Medina fue asignado a la operación.'),
    systemMessage('MSG-4001-2', 'CHAT-4001', isoAt(today, 8, 12), 'El vuelo DM161 fue asociado a la posición A5.'),
    occMessage('MSG-4001-3', 'CHAT-4001', isoAt(today, 8, 15), 'Carlos, confirma cuando inicien el proceso de descarga.', { status: 'read' }),
    agentMessage('MSG-4001-4', 'CHAT-4001', isoAt(today, 8, 17), 'Entendido, iniciamos la descarga en 5 minutos.', { readAt: isoAt(today, 8, 18) }),
    agentMessage('MSG-4001-5', 'CHAT-4001', isoAt(today, 8, 40), 'Ya iniciamos el proceso de descarga de equipaje.', { readAt: isoAt(today, 8, 41) }),
    systemMessage('MSG-4001-6', 'CHAT-4001', isoAt(today, 9, 2), 'La operación cambió a estado En ejecución.'),
    agentMessage('MSG-4001-7', 'CHAT-4001', isoAt(today, 9, 20), 'Tenemos un retraso menor por congestión en la banda 3.', {
      attachments: [{ id: 'ATT-4001-1', name: 'foto-banda-3.jpg', type: 'image', size: 842000, status: 'ready' }],
    }),
    agentMessage('MSG-4001-8', 'CHAT-4001', isoAt(today, 9, 35), '¿Podemos usar la banda 5 en su lugar?'),
  ],
  'CHAT-4002': [
    systemMessage('MSG-4002-1', 'CHAT-4002', isoAt(today, 10, 50), 'El reporte de la operación fue enviado y quedó pendiente de revisión.'),
    agentMessage('MSG-4002-2', 'CHAT-4002', isoAt(today, 10, 52), 'Buenas, el reporte de AA904 ya fue enviado para revisión.', { readAt: isoAt(today, 10, 55) }),
    occMessage('MSG-4002-3', 'CHAT-4002', isoAt(today, 10, 55), 'Recibido, lo revisamos en breve.', { status: 'read' }),
  ],
  'CHAT-4003': [
    systemMessage('MSG-4003-1', 'CHAT-4003', isoAt(today, 7, 0), 'El vuelo CM345 fue asociado a la posición BN8.'),
    systemMessage('MSG-4003-2', 'CHAT-4003', isoAt(today, 7, 5), 'El agente Rafael Peña fue asignado a la operación.'),
    agentMessage('MSG-4003-3', 'CHAT-4003', isoAt(today, 7, 10), 'Buenas, iniciando desembarque de CM345.', { readAt: isoAt(today, 7, 11) }),
    occMessage('MSG-4003-4', 'CHAT-4003', isoAt(today, 7, 12), 'Perfecto, avísame cuando termine el equipaje.', { status: 'read' }),
    agentMessage('MSG-4003-5', 'CHAT-4003', isoAt(today, 7, 45), 'Equipaje completado sin novedades.', { readAt: isoAt(today, 7, 46) }),
    systemMessage('MSG-4003-6', 'CHAT-4003', isoAt(today, 7, 46), 'La operación cambió a estado En ejecución.'),
    occMessage('MSG-4003-7', 'CHAT-4003', isoAt(today, 7, 50), 'Gracias, quedo pendiente del reporte final.', { status: 'delivered' }),
  ],
  'CHAT-4004': [
    agentMessage('MSG-4004-1', 'CHAT-4004', isoAt(yesterday, 8, 40), 'Terminamos el servicio, enviando reporte.', { readAt: isoAt(yesterday, 8, 41) }),
    systemMessage('MSG-4004-2', 'CHAT-4004', isoAt(yesterday, 8, 42), 'El reporte de la operación fue enviado y quedó pendiente de revisión.'),
    systemMessage('MSG-4004-3', 'CHAT-4004', isoAt(yesterday, 14, 5), 'La operación fue devuelta con correcciones.'),
    occMessage('MSG-4004-4', 'CHAT-4004', isoAt(yesterday, 14, 10), 'José, falta la evidencia de cierre de limpieza y catering, favor adjuntar.', { status: 'read' }),
    agentMessage('MSG-4004-5', 'CHAT-4004', isoAt(yesterday, 14, 20), 'Enviado, disculpen la demora.', {
      readAt: isoAt(yesterday, 14, 22),
      attachments: [{ id: 'ATT-4004-1', name: 'evidencia-limpieza.pdf', type: 'document', size: 210000, status: 'ready' }],
    }),
    systemMessage('MSG-4004-6', 'CHAT-4004', isoAt(yesterday, 14, 25), 'La conversación fue marcada como cerrada.'),
  ],
  'CHAT-4005': [
    systemMessage('MSG-4005-1', 'CHAT-4005', isoAt(older, 9, 0), 'El agente Katherine Objío fue asignada a la operación.'),
    agentMessage('MSG-4005-2', 'CHAT-4005', isoAt(older, 9, 5), 'Buenas, quedo atenta a la asignación de posición.', { readAt: isoAt(older, 9, 10) }),
    systemMessage('MSG-4005-3', 'CHAT-4005', isoAt(today, 12, 20), 'Se detectó una discrepancia en la posición reportada (B21 planificado vs B32 ejecutado).'),
    agentMessage('MSG-4005-4', 'CHAT-4005', isoAt(today, 12, 25), 'Confirmo, tuvimos que reubicar a B32 por mantenimiento en B21.'),
  ],
  'CHAT-4006': [systemMessage('MSG-4006-1', 'CHAT-4006', isoAt(today, 6, 35), 'La operación fue creada y asignada a Carlos Medina.')],
};

function structuredCloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function computeConversationSummary(template, messages) {
  const lastMessage = messages[messages.length - 1] ?? null;
  const unreadCount = messages.filter(message => message.senderRole === 'agent' && !message.readAt).length;
  return {
    ...template,
    lastMessage: lastMessage?.content ?? '',
    lastMessageAt: lastMessage?.createdAt ?? null,
    unreadCount,
  };
}

let conversationStore = CONVERSATION_TEMPLATES.map(structuredCloneValue);
let messageStore = structuredCloneValue(MESSAGES_BY_CONVERSATION);
let conversationIdCounter = conversationStore.length + 1;
let messageIdCounter = 1;

function findConversationOrThrow(id) {
  const conversation = conversationStore.find(item => item.id === id);
  if (!conversation) throw new Error(`No existe la conversación ${id}`);
  return conversation;
}

export async function getConversations(stationCode = 'PUJ') {
  const conversations = conversationStore.map(template =>
    computeConversationSummary(template, messageStore[template.id] ?? [])
  );
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    conversations: structuredCloneValue(conversations),
  };
}

export async function getMessages(conversationId) {
  findConversationOrThrow(conversationId);
  return {
    conversationId,
    messages: structuredCloneValue(messageStore[conversationId] ?? []),
  };
}

export async function sendMessage(conversationId, content, attachments = []) {
  const conversation = findConversationOrThrow(conversationId);
  const message = occMessage(`MSG-${conversation.id}-${messageIdCounter++}`, conversationId, new Date().toISOString(), content, {
    status: 'sent',
    attachments,
  });
  messageStore[conversationId] = [...(messageStore[conversationId] ?? []), message];
  return structuredCloneValue(message);
}

export async function markConversationAsRead(conversationId) {
  const conversation = findConversationOrThrow(conversationId);
  const now = new Date().toISOString();
  messageStore[conversationId] = (messageStore[conversationId] ?? []).map(message =>
    message.senderRole === 'agent' && !message.readAt ? { ...message, readAt: now } : message
  );
  return structuredCloneValue(computeConversationSummary(conversation, messageStore[conversationId]));
}

export async function closeConversation(conversationId) {
  const conversation = findConversationOrThrow(conversationId);
  conversation.status = 'closed';
  const closingMessage = systemMessage(
    `MSG-${conversation.id}-${messageIdCounter++}`,
    conversationId,
    new Date().toISOString(),
    'La conversación fue marcada como cerrada.'
  );
  messageStore[conversationId] = [...(messageStore[conversationId] ?? []), closingMessage];
  return {
    conversation: structuredCloneValue(computeConversationSummary(conversation, messageStore[conversationId])),
    message: structuredCloneValue(closingMessage),
  };
}

export async function getAvailableFlightsForNewConversation() {
  const openFlightIds = new Set(conversationStore.map(conversation => conversation.flightId));
  return structuredCloneValue(AVAILABLE_FLIGHT_TEMPLATES.filter(flight => !openFlightIds.has(flight.flightId)));
}

export async function createConversation({ flightId, operationId, agentId }) {
  const template = AVAILABLE_FLIGHT_TEMPLATES.find(
    flight => flight.flightId === flightId && flight.operationId === operationId && flight.agentId === agentId
  );
  if (!template) throw new Error('No se encontró el vuelo/operación/agente indicado para la nueva conversación.');

  const id = `CHAT-${5000 + conversationIdCounter++}`;
  const now = new Date().toISOString();
  const conversation = {
    id,
    flightId: template.flightId,
    flightNumber: template.flightNumber,
    airline: template.airline,
    origin: template.origin,
    destination: template.destination,
    position: template.position,
    operationId: template.operationId,
    agentId: template.agentId,
    agentName: template.agentName,
    agentStatus: null,
    agentLastSeenAt: null,
    status: 'active',
    requiresAttention: false,
  };
  conversationStore = [conversation, ...conversationStore];
  messageStore[id] = [
    systemMessage(`MSG-${id}-${messageIdCounter++}`, id, now, `El agente ${template.agentName} fue asignado a la operación.`),
  ];

  return structuredCloneValue(computeConversationSummary(conversation, messageStore[id]));
}

// Simula el canal en tiempo real (WebSocket/polling) del backend: cada cierto intervalo, un agente
// de una conversación activa (no cerrada) envía un mensaje nuevo. onIncomingMessage recibe
// { conversationId, message }. Devuelve una función para cancelar la suscripción.
const REALTIME_INTERVAL_MS = 25000;
const SIMULATED_AGENT_REPLIES = [
  'Confirmado, quedamos atentos.',
  'Servicio en progreso, sin novedades.',
  'Necesitamos apoyo adicional en posición.',
  'Reporte actualizado enviado.',
];

export function subscribeToConversationUpdates(onIncomingMessage) {
  let tickCount = 0;

  const intervalId = setInterval(() => {
    tickCount += 1;
    const eligible = conversationStore.filter(conversation => conversation.status !== 'closed');
    if (eligible.length === 0) return;

    const conversation = eligible[tickCount % eligible.length];
    const content = SIMULATED_AGENT_REPLIES[tickCount % SIMULATED_AGENT_REPLIES.length];
    const message = agentMessage(`MSG-${conversation.id}-${messageIdCounter++}`, conversation.id, new Date().toISOString(), content);
    messageStore[conversation.id] = [...(messageStore[conversation.id] ?? []), message];

    onIncomingMessage({ conversationId: conversation.id, message: structuredCloneValue(message) });
  }, REALTIME_INTERVAL_MS);

  return () => clearInterval(intervalId);
}

// Únicamente para pruebas: restaura el store mock a su estado inicial.
export function __resetChatStoreForTests() {
  conversationStore = CONVERSATION_TEMPLATES.map(structuredCloneValue);
  messageStore = structuredCloneValue(MESSAGES_BY_CONVERSATION);
  conversationIdCounter = conversationStore.length + 1;
  messageIdCounter = 1;
}
