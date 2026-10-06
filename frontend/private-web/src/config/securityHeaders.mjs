const MAP_TILE_ORIGINS = [
  'https://demotiles.maplibre.org',
  'https://tiles.openfreemap.org',
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
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self' ${apiOrigin} ${websocketOrigin} ${tileOrigins}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `img-src 'self' data: blob: ${apiOrigin} ${tileOrigins}`,
    `media-src 'self' blob: ${apiOrigin}`,
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "worker-src 'self' blob:",
  ].join('; ');
}
