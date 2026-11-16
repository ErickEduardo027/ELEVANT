// Connection (from leases) and chosen availability are separate server facts. A chosen
// status is only shown while the server reports the account connected; without data the
// indicator stays neutral instead of guessing.
export const SELECTABLE_AVAILABILITIES = ['available', 'busy', 'doNotDisturb', 'beRightBack', 'away', 'appearOffline'];

export function resolvePresence(person) {
  if (!person || person.state === 'unknown') return person?.availability === 'appearOffline' ? 'offline' : 'unknown';
  if (person.availability === 'appearOffline' || person.state === 'offline') return 'offline';
  return person.availability ?? (person.state === 'active' ? 'available' : 'away');
}

export const presenceMessages = {
  es: {
    status: { available: 'Disponible', busy: 'Ocupado', doNotDisturb: 'No molestar', beRightBack: 'Vuelvo enseguida',
      away: 'Ausente', offline: 'Desconectado', unknown: 'Sin información de presencia' },
    choose: { available: 'Disponible', busy: 'Ocupado', doNotDisturb: 'No molestar', beRightBack: 'Vuelvo enseguida',
      away: 'Ausente', appearOffline: 'Mostrar como desconectado' },
    people: 'Participantes', none: 'Sin información de presencia', last: 'Última actividad',
    myStatus: 'Mi estado', automatic: 'Automático', reset: 'Restablecer estado automático',
    message: 'Mensaje de estado', messagePlaceholder: 'Ej.: Atendiendo operaciones de una aerolínea',
    messageHint: 'Visible para los participantes de tus conversaciones. Máx. {max} caracteres.',
    save: 'Guardar mensaje', clear: 'Borrar mensaje', saving: 'Guardando…',
    error: 'No fue posible actualizar tu estado.', loadError: 'No fue posible leer tu estado.', retry: 'Reintentar',
    unsupported: 'Tu cuenta no publica presencia en este chat.',
    ephemeral: 'El estado elegido se publica solo mientras estás conectado.',
  },
  en: {
    status: { available: 'Available', busy: 'Busy', doNotDisturb: 'Do not disturb', beRightBack: 'Be right back',
      away: 'Away', offline: 'Offline', unknown: 'No presence information' },
    choose: { available: 'Available', busy: 'Busy', doNotDisturb: 'Do not disturb', beRightBack: 'Be right back',
      away: 'Away', appearOffline: 'Appear offline' },
    people: 'Participants', none: 'No presence information', last: 'Last activity',
    myStatus: 'My status', automatic: 'Automatic', reset: 'Reset to automatic status',
    message: 'Status message', messagePlaceholder: 'E.g.: Handling an airline’s operations',
    messageHint: 'Visible to participants in your conversations. Max {max} characters.',
    save: 'Save message', clear: 'Clear message', saving: 'Saving…',
    error: 'Your status could not be updated.', loadError: 'Your status could not be read.', retry: 'Retry',
    unsupported: 'Your account does not publish presence in this chat.',
    ephemeral: 'A chosen status is published only while you are connected.',
  },
};
