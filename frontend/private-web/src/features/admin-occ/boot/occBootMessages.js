// What the OCC boot screen announces to screen readers, in Spanish and English. The screen mounts above AdminOccLayout,
// which sets the LanguageScope, so OccBootProvider reads the stored language itself, as AccessGate does.
export const occBootMessages = {
  es: {
    preparing: 'Preparando el centro de operaciones…',
    ready: 'Listo.',
  },
  en: {
    preparing: 'Preparing the operations centre…',
    ready: 'Ready.',
  },
};
