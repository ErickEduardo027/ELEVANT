// The words of «Tablets» (phase 2, block E, 2-N02), in Spanish and English. The Spanish is the screen's text as it was
// before U6, word for word: the cycle E2E (fase2-preoperacion.spec.ts) reads the heading «Tablets» and «Cargando las
// tablets…», and the dialogs keep their sentences. A command's words are templates: `{tablet}` is the tablet's name and
// `{agent}` its last agent's. What a refused command means comes from services/deviceProblemMessages.js, in Spanish, as
// every OCC service explains its codes.
export const devicesMessages = {
  es: {
    title: 'Tablets',
    states: {
      noStation: 'Tu cuenta no tiene una estación OCC autorizada.',
      loading: 'Cargando las tablets…',
      forbidden: 'Tu acceso no permite ver las tablets de esta estación.',
      retry: 'Reintentar',
      readOnly: 'Tu acceso permite consultar las tablets, no liberarlas ni revocarlas.',
    },
    list: {
      title: 'Tablets de la estación',
      about: 'Las tablets son compartidas: cerrar sesión las libera y el siguiente agente las toma. Nada se borra; cada cambio queda auditado.',
      emptyTitle: 'Sin tablets registradas',
      emptyDescription: 'Una tablet aparece aquí cuando un agente de la estación inicia sesión en ella.',
      columns: {
        tablet: 'Tablet',
        agent: 'Agente',
        lastSeen: 'Última conexión',
        status: 'Estado',
      },
    },
    unnamed: 'Tablet {platform}',
    app: 'App {version}',
    holding: 'En manos de',
    lastAgent: 'Último agente',
    noAgent: 'Sin agente',
    since: 'desde {date}',
    // Who holds each tablet (services/occDevicesService.js, DEVICE_STATUSES).
    status: {
      Bound: 'En uso',
      Unbound: 'Libre',
      Revoked: 'Revocada',
    },
    inProgress: 'Operación en curso',
    inProgressHint: 'Otro agente no puede tomarla hasta que este cierre sesión o la liberes.',
    unbind: 'Liberar',
    revoke: 'Revocar',
    cancel: 'Cancelar',
    saving: 'Guardando…',
    // Revoking ends the sessions of the tablet's last agent, also when OCC had freed it, unless that agent signed out of
    // it (2-N02): the copy only claims what the server does.
    commands: {
      unbind: {
        title: 'Liberar {tablet}',
        description: 'La tablet queda libre: el próximo agente que inicie sesión en ella la tomará, aunque el anterior tenga una operación en curso. El agente anterior ya no podrá enviar desde ella.',
        reasonLabel: 'Motivo (opcional)',
        submit: 'Liberar tablet',
        done: '{tablet} quedó libre para el próximo agente.',
      },
      revoke: {
        title: 'Revocar {tablet}',
        descriptionBound: 'Úsalo solo con una tablet perdida o robada: nunca más podrá vincularse con ELEVANT y se cierran todas las sesiones de {agent}. No se puede deshacer.',
        descriptionFree: 'Úsalo solo con una tablet perdida o robada: nunca más podrá vincularse con ELEVANT. Si {agent} no cerró sesión en ella, se cierran todas sus sesiones. No se puede deshacer.',
        reasonLabel: 'Motivo',
        submit: 'Revocar tablet',
        done: '{tablet} quedó revocada; ya no queda ninguna sesión abierta en ella.',
      },
      lastAgent: 'su último agente',
    },
  },
  en: {
    title: 'Tablets',
    states: {
      noStation: 'Your account has no authorized OCC station.',
      loading: 'Loading the tablets…',
      forbidden: 'Your access does not allow viewing the tablets of this station.',
      retry: 'Retry',
      readOnly: 'Your access lets you view the tablets, not release or revoke them.',
    },
    list: {
      title: 'Station tablets',
      about: 'Tablets are shared: signing out frees one and the next agent takes it. Nothing is deleted; every change is audited.',
      emptyTitle: 'No tablets registered',
      emptyDescription: 'A tablet appears here when an agent of the station signs in on it.',
      columns: {
        tablet: 'Tablet',
        agent: 'Agent',
        lastSeen: 'Last connection',
        status: 'Status',
      },
    },
    unnamed: 'Tablet {platform}',
    app: 'App {version}',
    holding: 'Held by',
    lastAgent: 'Last agent',
    noAgent: 'No agent',
    since: 'since {date}',
    status: {
      Bound: 'In use',
      Unbound: 'Free',
      Revoked: 'Revoked',
    },
    inProgress: 'Operation in progress',
    inProgressHint: 'Another agent cannot take it until this one signs out or you release it.',
    unbind: 'Release',
    revoke: 'Revoke',
    cancel: 'Cancel',
    saving: 'Saving…',
    commands: {
      unbind: {
        title: 'Release {tablet}',
        description: 'The tablet becomes free: the next agent who signs in on it takes it, even if the previous one has an operation in progress. The previous agent can no longer send from it.',
        reasonLabel: 'Reason (optional)',
        submit: 'Release tablet',
        done: '{tablet} is free for the next agent.',
      },
      revoke: {
        title: 'Revoke {tablet}',
        descriptionBound: 'Use it only for a lost or stolen tablet: it can never be linked to ELEVANT again and every session of {agent} ends. This cannot be undone.',
        descriptionFree: 'Use it only for a lost or stolen tablet: it can never be linked to ELEVANT again. If {agent} did not sign out of it, every session of theirs ends. This cannot be undone.',
        reasonLabel: 'Reason',
        submit: 'Revoke tablet',
        done: '{tablet} is revoked; no session is left open on it.',
      },
      lastAgent: 'its last agent',
    },
  },
};
