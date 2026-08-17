const INITIAL_CONVERSATIONS = [
  {
    id: 'CONV-01',
    participant: 'Administrador / OCC',
    role: 'Administrador/OCC',
    contextType: 'Contrato',
    contextLabel: 'CTR-2026-018 · Arajet',
    unreadCount: 2,
    messages: [
      { id: 'MSG-01', sender: 'Administrador / OCC', sentAt: '2026-08-10T09:20:00-04:00', text: 'Confirma si el servicio GPU está vigente para la operación DM610.' },
      { id: 'MSG-02', sender: 'Departamento de Contratos', sentAt: '2026-08-10T09:28:00-04:00', text: 'Sí, se encuentra vigente según el contrato CTR-2026-018.' },
      { id: 'MSG-03', sender: 'Administrador / OCC', sentAt: '2026-08-10T09:31:00-04:00', text: 'Recibido. Lo asociaré a la planificación.' },
    ],
  },
  {
    id: 'CONV-02',
    participant: 'Agente de Rampa · José Ramírez',
    role: 'Agente de Rampa',
    contextType: 'Servicio',
    contextLabel: 'GPU · DM610',
    unreadCount: 0,
    messages: [
      { id: 'MSG-04', sender: 'Agente de Rampa · José Ramírez', sentAt: '2026-08-09T16:05:00-04:00', text: '¿La hora adicional del GPU está contemplada en el contrato?' },
      { id: 'MSG-05', sender: 'Departamento de Contratos', sentAt: '2026-08-09T16:12:00-04:00', text: 'La tarifa es por hora. Registra el tiempo real para la conciliación.' },
    ],
  },
  {
    id: 'CONV-03',
    participant: 'Administrador / OCC',
    role: 'Administrador/OCC',
    contextType: 'Solicitud',
    contextLabel: 'SOL-107 · Air Century',
    unreadCount: 0,
    messages: [
      { id: 'MSG-06', sender: 'Departamento de Contratos', sentAt: '2026-08-08T15:25:00-04:00', text: 'Recibimos una solicitud de afiliación de Air Century.' },
      { id: 'MSG-07', sender: 'Administrador / OCC', sentAt: '2026-08-08T15:40:00-04:00', text: 'Informaremos disponibilidad operativa para completar la evaluación.' },
    ],
  },
];

let conversations = INITIAL_CONVERSATIONS.map(conversation => ({ ...conversation, messages: conversation.messages.map(message => ({ ...message })) }));

export async function getContractConversations() {
  return conversations.map(conversation => ({ ...conversation, messages: conversation.messages.map(message => ({ ...message })) }));
}

export async function markContractConversationRead(conversationId) {
  return updateConversation(conversationId, conversation => ({ ...conversation, unreadCount: 0 }));
}

export async function sendContractMessage(conversationId, text) {
  if (!text.trim()) throw new Error('El mensaje no puede estar vacío.');
  return updateConversation(conversationId, conversation => ({
    ...conversation,
    messages: [...conversation.messages, { id: `MSG-${Date.now()}`, sender: 'Departamento de Contratos', sentAt: new Date().toISOString(), text: text.trim() }],
  }));
}

function updateConversation(conversationId, transform) {
  let updated = null;
  conversations = conversations.map(conversation => {
    if (conversation.id !== conversationId) return conversation;
    updated = transform(conversation);
    return updated;
  });
  if (!updated) throw new Error('La conversación no existe.');
  return Promise.resolve({ ...updated, messages: updated.messages.map(message => ({ ...message })) });
}

export function __resetContractCommunicationsForTests() {
  conversations = INITIAL_CONVERSATIONS.map(conversation => ({ ...conversation, messages: conversation.messages.map(message => ({ ...message })) }));
}
