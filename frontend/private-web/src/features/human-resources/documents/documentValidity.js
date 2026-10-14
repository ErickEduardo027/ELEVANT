// Vocabulario de vigencia que devuelve la API (`validity`) para habilitaciones
// y carnets. La clasificación la hace el servidor contra `asOf`; aquí sólo se
// traduce a etiquetas y tonos.
export const DOCUMENT_VALIDITIES = ['Valid', 'ExpiringSoon', 'Expired', 'Upcoming'];

const LABELS = {
  feminine: { Valid: 'Vigente', ExpiringSoon: 'Por vencer', Expired: 'Vencida', Upcoming: 'Aún no inicia' },
  masculine: { Valid: 'Vigente', ExpiringSoon: 'Por vencer', Expired: 'Vencido', Upcoming: 'Aún no inicia' },
};

const TONES = { Valid: 'success', ExpiringSoon: 'warning', Expired: 'danger', Upcoming: 'neutral' };

export function validityLabel(validity, gender = 'feminine') {
  return LABELS[gender]?.[validity] ?? validity;
}

export function validityTone(validity) {
  return TONES[validity] ?? 'neutral';
}

/** Fecha local del navegador (no UTC) en formato ISO, para que «hoy» coincida con la estación. */
export function localToday(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
