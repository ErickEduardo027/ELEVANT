const MAP_TILE_ORIGINS = [
  'https://demotiles.maplibre.org',
  'https://tiles.openfreemap.org',
];
// Fuentes públicas sin clave autorizadas para la consola OCC: observación
// METAR de MDPC (Iowa Environmental Mesonet, no oficial) e imagen GOES-East
// de NASA GIBS. Ambas sirven CORS abierto; no llevan credenciales.
const PUBLIC_DATA_ORIGINS = [
  'https://mesonet.agron.iastate.edu',
  'https://gibs.earthdata.nasa.gov',
];

export function buildContentSecurityPolicy(apiOrigin, nonce, { development = false } = {}) {
  const parsed = new URL(apiOrigin);
  if (parsed.protocol !== 'https:' || parsed.origin !== apiOrigin ||
      parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('AVIAM API origin must be a canonical HTTPS origin.');
  }
  if (!/^[A-Za-z0-9+/_=-]{8,}$/.test(nonce)) {
    throw new Error('A request nonce is required.');
  }

  const websocketOrigin = `wss://${parsed.host}`;
  const tileOrigins = MAP_TILE_ORIGINS.join(' ');
  const dataOrigins = PUBLIC_DATA_ORIGINS.join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self' ${apiOrigin} ${websocketOrigin} ${tileOrigins} ${dataOrigins}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `img-src 'self' data: blob: ${apiOrigin} ${tileOrigins} ${dataOrigins}`,
    `media-src 'self' blob: ${apiOrigin}`,
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "worker-src 'self' blob:",
  ].join('; ');
}
