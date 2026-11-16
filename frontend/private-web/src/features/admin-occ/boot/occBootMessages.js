// What the OCC boot screen announces to screen readers, in Spanish and English (the app's American English, as in
// «Operations Control Center»). The screen itself shows only the logo, which is not translated. It mounts above
// AdminOccLayout, which sets the LanguageScope, so OccBootProvider reads the stored language itself, as AccessGate does.
export const occBootMessages = {
  es: {
    preparing: 'Preparando el centro de operaciones…',
    ready: 'Listo.',
  },
  en: {
    preparing: 'Preparing the operations center…',
    ready: 'Ready.',
  },
};
