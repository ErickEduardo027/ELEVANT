// Connection (from leases) and chosen availability are separate server facts. A chosen
// status is only shown while the server reports the account connected; without data the
// indicator stays neutral instead of guessing.
export const SELECTABLE_AVAILABILITIES = ['available', 'busy', 'doNotDisturb', 'beRightBack', 'away', 'appearOffline'];

export function resolvePresence(person) {
  if (!person || person.state === 'unknown') return person?.availability === 'appearOffline' ? 'offline' : 'unknown';
  if (person.availability === 'appearOffline' || person.state === 'offline') return 'offline';
  return person.availability ?? (person.state === 'active' ? 'available' : 'away');
}

/**
 * How each presence is drawn (design D28): a neutral glyph whose shape says the state, next to its word. «Ocupado» in
 * red and «Disponible» in green used to differ only by hue, and red is the OCC's urgent signal (contratos 2.4), so no
 * presence has a hue of its own.
 * - `filled`: available. `filled-bar`: busy and do not disturb. `half`: away and be right back.
 * - `hollow`: offline, also an account that chose to appear offline. `dashed`: no presence information.
 */
export const PRESENCE_SHAPES = Object.freeze({
  available: 'filled',
  busy: 'filled-bar',
  doNotDisturb: 'filled-bar',
  beRightBack: 'half',
  away: 'half',
  offline: 'hollow',
  unknown: 'dashed',
});

/** The shapes in the order the legend lists them, each with the presence that draws it. */
export const PRESENCE_LEGEND = Object.freeze([
  Object.freeze({ shape: 'filled', presence: 'available' }),
  Object.freeze({ shape: 'filled-bar', presence: 'busy' }),
  Object.freeze({ shape: 'half', presence: 'away' }),
  Object.freeze({ shape: 'hollow', presence: 'offline' }),
  Object.freeze({ shape: 'dashed', presence: 'unknown' }),
]);

/** The shape of a presence that resolvePresence gives; an unknown value throws, like any vocabulary typo. */
export function presenceShape(presence) {
  if (!Object.hasOwn(PRESENCE_SHAPES, presence ?? '')) throw new RangeError(`Unknown presence: ${String(presence)}`);
  return PRESENCE_SHAPES[presence];
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
    legend: {
      label: 'Presencia',
      shapes: {
        filled: 'Disponible',
        'filled-bar': 'Ocupado o no molestar',
        half: 'Ausente o vuelvo enseguida',
        hollow: 'Desconectado',
        dashed: 'Sin información',
      },
    },
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
    legend: {
      label: 'Presence',
      shapes: {
        filled: 'Available',
        'filled-bar': 'Busy or do not disturb',
        half: 'Away or be right back',
        hollow: 'Offline',
        dashed: 'No information',
      },
    },
  },
};
