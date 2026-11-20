// The words the OCC primitives and every legend share, in Spanish and English. The words of the stand states, the
// signals and the tags themselves live in statusVocabulary.js; these are the names of a legend's sections and what each
// tag means, so the status bar's «Leyenda» and the legends that maps and boards add later (contratos 2.4) read alike.
// `alerts` belongs to OccAlertQueue, `drawer` to OccDrawer and `toasts` to OccToastStack; `panel` to OccPanel and its
// OccRemoteView, `skeleton` to OccSkeleton, `stat` to OccStatTile, `time` to occTime.js, `flightStrip` to
// OccFlightStrip, `timeline` to OccTimeline and occTimelineModel.js, `milestones` to OccMilestoneStrip and
// milestonePhases.js, `table` to OccDataTable and `dialog` to OccDialog. The stale notice and the relative words are the
// ones the dashboard and the maps' data block use.
export const occUiMessages = {
  es: {
    legend: {
      stands: 'Posiciones',
      signals: 'Señales',
      tags: 'Marcas',
      tagMeaning: {
        demo: 'Simulado para la demostración',
        estimated: 'Calculado, no medido',
        unofficial: 'Dato de referencia, no oficial',
        stale: 'Muestra el último dato recibido',
      },
    },
    alerts: {
      title: 'Alertas',
      unreceived: '{count} sin recibir',
      recentTitle: 'Avisos recientes',
      empty: 'No hay alertas sin atender.',
      emptyRecent: 'No hay avisos recientes.',
      loading: 'Cargando avisos…',
      error: 'No se pudieron cargar los avisos.',
      forbidden: 'No tienes permiso para ver los avisos.',
      retry: 'Reintentar',
      acknowledge: 'Recibido',
      open: 'Abrir',
      receivedAt: 'Recibida a las {time}',
      acknowledgeFailed: 'No se pudo marcar como recibida. Vuelve a intentarlo.',
    },
    drawer: {
      close: 'Cerrar',
    },
    toasts: {
      dismiss: 'Cerrar notificación',
    },
    panel: {
      loading: 'Cargando…',
      empty: 'No hay datos para mostrar.',
      error: 'No se pudo cargar esta información.',
      timeout: 'La consulta tardó demasiado. Comprueba la conexión y vuelve a intentarlo.',
      forbidden: 'No tienes permiso para ver esta información.',
      retry: 'Reintentar',
      stale: 'La última actualización falló; se muestran los datos consultados a las {time}.',
    },
    skeleton: {
      loading: 'Cargando…',
    },
    stat: {
      loading: 'Cargando',
      lowerBound: 'al menos {value}',
    },
    time: {
      now: 'ahora',
      in: 'en {duration}',
      ago: 'hace {duration}',
      minutes: '{count} min',
      hours: '{hours} h',
      hoursMinutes: '{hours} h {minutes} min',
    },
    flightStrip: {
      arrival: 'Llegada',
      departure: 'Salida',
      from: 'desde {code}',
      to: 'hacia {code}',
      stand: 'posición {code}',
      noStand: 'Sin posición',
      noTime: 'Sin hora',
      estimated: 'posición estimada',
      // The countdown of an arrival's runway time, which only says that it landed (N23).
      landedAgo: 'aterrizó hace {duration}',
      timeKind: {
        actual: 'real',
        estimated: 'estimada',
        scheduled: 'programada',
      },
      timeKindShort: {
        actual: 'real',
        estimated: 'est.',
        scheduled: 'prog.',
      },
    },
    timeline: {
      nowAt: 'ahora {time}',
      flights: '{arrival} a {departure}',
      stand: 'posición {code}',
      arrives: 'llega {time} {kind}',
      departs: 'sale {time} {kind}',
      noArrival: 'sin llegada',
      noDeparture: 'sin salida',
      state: {
        planned: 'planificada',
        onStand: 'en posición',
        departed: 'salió',
      },
      inOperation: 'en operación',
      demo: 'demo',
      estimated: 'posición estimada',
      selected: 'elegida',
    },
    milestones: {
      label: 'Hitos de la escala',
      count: '{done} de {total}',
      pending: 'Pendiente',
      empty: 'Los hitos aparecen cuando la escala tiene una operación.',
      phases: {
        arrival: 'Llegada',
        on_stand: 'En posición',
        departure: 'Salida',
        pushback: 'Retroempuje',
      },
    },
    table: {
      expand: 'Mostrar detalle',
      collapse: 'Ocultar detalle',
      sortAscending: 'orden ascendente',
      sortDescending: 'orden descendente',
      sortBy: 'Ordenar por {column}',
    },
    dialog: {
      close: 'Cerrar',
    },
  },
  en: {
    legend: {
      stands: 'Stands',
      signals: 'Signals',
      tags: 'Tags',
      tagMeaning: {
        demo: 'Simulated for the demo',
        estimated: 'Calculated, not measured',
        unofficial: 'Reference data, not official',
        stale: 'Shows the last data received',
      },
    },
    alerts: {
      title: 'Alerts',
      unreceived: '{count} not acknowledged',
      recentTitle: 'Recent notices',
      empty: 'No alerts need attention.',
      emptyRecent: 'No recent notices.',
      loading: 'Loading notices…',
      error: 'The notices could not be loaded.',
      forbidden: 'You do not have permission to see the notices.',
      retry: 'Retry',
      acknowledge: 'Acknowledge',
      open: 'Open',
      receivedAt: 'Acknowledged at {time}',
      acknowledgeFailed: 'It could not be acknowledged. Try again.',
    },
    drawer: {
      close: 'Close',
    },
    toasts: {
      dismiss: 'Close notification',
    },
    panel: {
      loading: 'Loading…',
      empty: 'There is no data to show.',
      error: 'This information could not be loaded.',
      timeout: 'The request took too long. Check the connection and try again.',
      forbidden: 'You do not have permission to see this information.',
      retry: 'Retry',
      stale: 'The last refresh failed; showing data retrieved at {time}.',
    },
    skeleton: {
      loading: 'Loading…',
    },
    stat: {
      loading: 'Loading',
      lowerBound: 'at least {value}',
    },
    time: {
      now: 'now',
      in: 'in {duration}',
      ago: '{duration} ago',
      minutes: '{count} min',
      hours: '{hours} h',
      hoursMinutes: '{hours} h {minutes} min',
    },
    flightStrip: {
      arrival: 'Arrival',
      departure: 'Departure',
      from: 'from {code}',
      to: 'to {code}',
      stand: 'stand {code}',
      noStand: 'No stand',
      noTime: 'No time',
      estimated: 'estimated position',
      landedAgo: 'landed {duration} ago',
      timeKind: {
        actual: 'actual',
        estimated: 'estimated',
        scheduled: 'scheduled',
      },
      timeKindShort: {
        actual: 'actual',
        estimated: 'est.',
        scheduled: 'sched.',
      },
    },
    timeline: {
      nowAt: 'now {time}',
      flights: '{arrival} to {departure}',
      stand: 'stand {code}',
      arrives: 'arrives {time} {kind}',
      departs: 'departs {time} {kind}',
      noArrival: 'no arrival',
      noDeparture: 'no departure',
      state: {
        planned: 'planned',
        onStand: 'on stand',
        departed: 'departed',
      },
      inOperation: 'in operation',
      demo: 'demo',
      estimated: 'estimated position',
      selected: 'selected',
    },
    milestones: {
      label: 'Turnaround milestones',
      count: '{done} of {total}',
      pending: 'Pending',
      empty: 'Milestones appear when the turnaround has an operation.',
      phases: {
        arrival: 'Arrival',
        on_stand: 'On stand',
        departure: 'Departure',
        pushback: 'Pushback',
      },
    },
    table: {
      expand: 'Show details',
      collapse: 'Hide details',
      sortAscending: 'ascending order',
      sortDescending: 'descending order',
      sortBy: 'Sort by {column}',
    },
    dialog: {
      close: 'Close',
    },
  },
};
