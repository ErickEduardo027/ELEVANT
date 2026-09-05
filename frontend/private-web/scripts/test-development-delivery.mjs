import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DevelopmentEnvironmentError,
  validateDevelopmentEnvironment,
} from './validate-development-env.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const validEnvironment = {
  VITE_ELEVANT_API_URL: 'https://api.elevant.test',
  VITE_PROTOTYPE_API_URL: 'https://api.elevant.test',
};

test('accepts one shared remote HTTPS API origin', () => {
  assert.deepEqual(validateDevelopmentEnvironment(validEnvironment), {
    apiOrigin: 'https://api.elevant.test',
  });
});

for (const [name, overrides, expected] of [
  ['a missing primary URL', { VITE_ELEVANT_API_URL: '' }, /VITE_ELEVANT_API_URL is required/],
  ['a missing prototype URL', { VITE_PROTOTYPE_API_URL: '' }, /VITE_PROTOTYPE_API_URL is required/],
  ['plain HTTP', { VITE_ELEVANT_API_URL: 'http://api.elevant.test' }, /must use HTTPS/],
  ['localhost', { VITE_PROTOTYPE_API_URL: 'https://localhost:4310' }, /must not target localhost/],
  ['IPv4 loopback', { VITE_PROTOTYPE_API_URL: 'https://127.0.0.1:4310' }, /must not target localhost/],
  ['IPv6 loopback', { VITE_PROTOTYPE_API_URL: 'https://[::1]:4310' }, /must not target localhost/],
  ['an IP literal', { VITE_PROTOTYPE_API_URL: 'https://192.0.2.10' }, /must use the Development API DNS name/],
  ['credentials', { VITE_ELEVANT_API_URL: 'https://user:pass@api.elevant.test' }, /must not contain credentials/],
  ['a path', { VITE_ELEVANT_API_URL: 'https://api.elevant.test/v1' }, /must be an origin only/],
  ['a query', { VITE_ELEVANT_API_URL: 'https://api.elevant.test?preview=1' }, /must be an origin only/],
  ['a trailing slash', { VITE_PROTOTYPE_API_URL: 'https://api.elevant.test/' }, /exact origin without a trailing slash/],
  ['different origins', { VITE_PROTOTYPE_API_URL: 'https://other.elevant.test' }, /must use the same HTTPS origin/],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => validateDevelopmentEnvironment({ ...validEnvironment, ...overrides }),
      (error) => error instanceof DevelopmentEnvironmentError && expected.test(error.message),
    );
  });
}

test('delivery files preserve the private, non-root runtime boundary', async () => {
  const [compose, dockerfile, nginx, securityHeaders] = await Promise.all([
    readFile(path.join(projectRoot, 'compose.development.aviam-web.yml'), 'utf8'),
    readFile(path.join(projectRoot, 'Dockerfile'), 'utf8'),
    readFile(path.join(projectRoot, 'nginx/default.conf'), 'utf8'),
    readFile(path.join(projectRoot, 'nginx/security-headers.conf'), 'utf8'),
  ]);

  assert.match(compose, /127\.0\.0\.1:18081:8080/);
  assert.match(compose, /ELEVANT_AVIAM_WEB_IMAGE:\?Set an immutable/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /name: elevant-dev-aviam-web-runtime/);
  assert.doesNotMatch(compose, /elevant-dev-data|1433|sqlserver/i);

  assert.match(dockerfile, /node:24-alpine@sha256:[0-9a-f]{64}/);
  assert.match(dockerfile, /nginx-unprivileged:1\.30\.4-alpine3\.24@sha256:[0-9a-f]{64}/);
  assert.match(dockerfile, /USER 101:101/);
  assert.match(dockerfile, /io\.elevant\.application="aviam-web"/);
  assert.match(dockerfile, /io\.elevant\.web\.api-origin=/);
  assert.match(dockerfile, /s\|__ELEVANT_API_ORIGIN__\|\$\{VITE_ELEVANT_API_URL\}\|g/);
  assert.doesNotMatch(dockerfile, /backend-prototipo|database\//i);

  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /try_files \/healthz =404/);
  assert.match(nginx, /location \^~ \/assets\//);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html/);
  assert.match(securityHeaders, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(securityHeaders, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(
    securityHeaders,
    /connect-src 'self' __ELEVANT_API_ORIGIN__ https:\/\/demotiles\.maplibre\.org https:\/\/tiles\.openfreemap\.org;/,
  );
  assert.doesNotMatch(securityHeaders, /connect-src[^;]*(?:https:|wss:)(?:[ ;]|$)/);
});
