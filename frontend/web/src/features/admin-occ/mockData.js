export const CURRENT_USER_MOCK = { name: 'Laisha Ramírez', role: 'Administrador OCC' };

export function fallbackStation() {
  const now = new Date().toISOString();
  return { code: 'PUJ', localAbbr: 'AST', localTime: now, utcTime: now };
}
