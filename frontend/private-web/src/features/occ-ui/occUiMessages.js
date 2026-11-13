// The words the OCC primitives and every legend share, in Spanish and English. The words of the stand states, the
// signals and the tags themselves live in statusVocabulary.js; these are the names of a legend's sections and what each
// tag means, so the status bar's «Leyenda» and the legends that maps and boards add later (contratos 2.4) read alike.
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
  },
};
