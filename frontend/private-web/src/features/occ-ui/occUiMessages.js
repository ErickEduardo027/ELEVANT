// The words the OCC primitives and every legend share, in Spanish and English. The words of the stand states, the
// signals and the tags themselves live in statusVocabulary.js; these are the names of a legend's sections and what each
// tag means, so the status bar's «Leyenda» and the legends that maps and boards add later (contratos 2.4) read alike.
// `alerts` belongs to OccAlertQueue, `drawer` to OccDrawer and `toasts` to OccToastStack.
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
  },
};
