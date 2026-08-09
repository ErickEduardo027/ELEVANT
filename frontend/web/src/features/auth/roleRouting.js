export const ROLES = {
  ADMIN_OCC: 'ADMIN_OCC',
  GESTION_HUMANA: 'GESTION_HUMANA',
  CONTRATOS: 'CONTRATOS',
  FINANZAS: 'FINANZAS',
  AGENTE: 'AGENTE',
  CLIENTE_AEROLINEA: 'CLIENTE_AEROLINEA',
};

// Única fuente de verdad para "a qué entorno entra cada rol". Hoy se invoca
// desde el selector de entorno (EnvironmentSelectorPage) porque todavía no
// existe un backend que devuelva el rol autenticado; cuando exista, esta
// misma función se invoca con el rol real recibido del login y se retira el
// selector manual.
export function resolveHomeRouteForRole(role) {
  switch (role) {
    case ROLES.ADMIN_OCC:
      return '/admin-occ';
    case ROLES.GESTION_HUMANA:
      return '/human-resources';
    default:
      return null; // Contratos, Finanzas, Agente, Cliente/Aerolínea: aún sin entorno construido.
  }
}
