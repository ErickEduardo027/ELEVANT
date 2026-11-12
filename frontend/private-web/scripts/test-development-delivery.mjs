import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DevelopmentEnvironmentError,
  validateDevelopmentEnvironment,
} from './validate-development-env.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const repositoryRoot = path.resolve(projectRoot, '../..');

test('the MapLibre worker copy preserves the worker and every module it imports', async () => {
  const { copyMapLibreWorkerAssets, findUncopiedWorkerImports } = await import('./copy-maplibre-worker.mjs');
  const destination = await mkdtemp(path.join(tmpdir(), 'elevant-maplibre-'));
  try {
    await copyMapLibreWorkerAssets(destination);
    const worker = await readFile(path.join(destination, 'maplibre-gl-worker.mjs'));
    const shared = await readFile(path.join(destination, 'maplibre-gl-shared.mjs'));
    assert.deepEqual(worker, await readFile(path.join(projectRoot, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')));
    assert.deepEqual(shared, await readFile(path.join(projectRoot, 'node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs')));
    assert.deepEqual(findUncopiedWorkerImports(worker.toString()), []);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test('a MapLibre worker import that the copy would leave behind is reported', async () => {
  const { findUncopiedWorkerImports } = await import('./copy-maplibre-worker.mjs');
  // The worker of MapLibre 6.4 imported the shared module; from 6.13 it imports nothing.
  assert.deepEqual(findUncopiedWorkerImports('import{a as b}from"./maplibre-gl-shared.mjs";self.worker=b;'), []);
  assert.deepEqual(findUncopiedWorkerImports('self.worker=1;export{a as default};'), []);
  assert.deepEqual(
    findUncopiedWorkerImports([
      'import{a}from"./maplibre-gl-chunk.mjs";',
      "import './maplibre-gl-polyfill.mjs';",
      'export*from"../maplibre-gl-shared.mjs";',
      'const lazy=await import(`./maplibre-gl-lazy.mjs`);',
    ].join('')),
    ['./maplibre-gl-chunk.mjs', './maplibre-gl-polyfill.mjs', '../maplibre-gl-shared.mjs', './maplibre-gl-lazy.mjs'],
  );
});

const validEnvironment = {
  NEXT_PUBLIC_ELEVANT_API_URL: 'https://api.elevant.test',
  NEXT_PUBLIC_PROTOTYPE_API_URL: 'https://api.elevant.test',
  NEXT_PUBLIC_HR_DEMO_MODE: 'dashboard-read-only',
};

test('accepts one shared remote HTTPS API origin', () => {
  assert.deepEqual(validateDevelopmentEnvironment(validEnvironment), {
    apiOrigin: 'https://api.elevant.test',
    hrDemoMode: 'dashboard-read-only',
  });
});

test('legacy Vite variables alone cannot configure the Next release', () => {
  assert.throws(
    () => validateDevelopmentEnvironment({
      VITE_ELEVANT_API_URL: 'https://api.elevant.test',
      VITE_PROTOTYPE_API_URL: 'https://api.elevant.test',
      VITE_HR_DEMO_MODE: 'dashboard-read-only',
    }),
    (error) => error instanceof DevelopmentEnvironmentError && /NEXT_PUBLIC_ELEVANT_API_URL is required/.test(error.message),
  );
});

for (const [name, overrides, expected] of [
  ['a missing primary URL', { NEXT_PUBLIC_ELEVANT_API_URL: '' }, /NEXT_PUBLIC_ELEVANT_API_URL is required/],
  ['a missing prototype URL', { NEXT_PUBLIC_PROTOTYPE_API_URL: '' }, /NEXT_PUBLIC_PROTOTYPE_API_URL is required/],
  ['plain HTTP', { NEXT_PUBLIC_ELEVANT_API_URL: 'http://api.elevant.test' }, /must use HTTPS/],
  ['localhost', { NEXT_PUBLIC_PROTOTYPE_API_URL: 'https://localhost:4310' }, /must not target localhost/],
  ['IPv4 loopback', { NEXT_PUBLIC_PROTOTYPE_API_URL: 'https://127.0.0.1:4310' }, /must not target localhost/],
  ['IPv6 loopback', { NEXT_PUBLIC_PROTOTYPE_API_URL: 'https://[::1]:4310' }, /must not target localhost/],
  ['an IP literal', { NEXT_PUBLIC_PROTOTYPE_API_URL: 'https://192.0.2.10' }, /must use the Development API DNS name/],
  ['credentials', { NEXT_PUBLIC_ELEVANT_API_URL: 'https://user:pass@api.elevant.test' }, /must not contain credentials/],
  ['a path', { NEXT_PUBLIC_ELEVANT_API_URL: 'https://api.elevant.test/v1' }, /must be an origin only/],
  ['a query', { NEXT_PUBLIC_ELEVANT_API_URL: 'https://api.elevant.test?preview=1' }, /must be an origin only/],
  ['a trailing slash', { NEXT_PUBLIC_PROTOTYPE_API_URL: 'https://api.elevant.test/' }, /exact origin without a trailing slash/],
  ['different origins', { NEXT_PUBLIC_PROTOTYPE_API_URL: 'https://other.elevant.test' }, /must use the same HTTPS origin/],
  ['a missing HR demo mode', { NEXT_PUBLIC_HR_DEMO_MODE: '' }, /must equal dashboard-read-only/],
  ['another HR demo mode', { NEXT_PUBLIC_HR_DEMO_MODE: 'full-access' }, /must equal dashboard-read-only/],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => validateDevelopmentEnvironment({ ...validEnvironment, ...overrides }),
      (error) => error instanceof DevelopmentEnvironmentError && expected.test(error.message),
    );
  });
}

test('delivery files preserve the private, non-root runtime boundary', async () => {
  const [compose, dockerfile, certifier, webCi, layout] = await Promise.all([
    readFile(path.join(projectRoot, 'compose.development.aviam-web.yml'), 'utf8'),
    readFile(path.join(projectRoot, 'Dockerfile'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/certify-image.sh'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github/workflows/web-ci.yml'), 'utf8'),
    readFile(path.join(projectRoot, 'app/layout.jsx'), 'utf8'),
  ]);

  assert.match(compose, /127\.0\.0\.1:18081:8080/);
  assert.match(compose, /ELEVANT_AVIAM_WEB_IMAGE:\?Set an immutable/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /name: elevant-dev-aviam-web-runtime/);
  assert.doesNotMatch(compose, /elevant-dev-data|1433|sqlserver/i);

  assert.match(dockerfile, /node:24-alpine@sha256:[0-9a-f]{64}/);
  assert.match(dockerfile, /USER 101:101/);
  assert.match(dockerfile, /io\.elevant\.application="aviam-web"/);
  assert.match(dockerfile, /io\.elevant\.web\.api-origin=/);
  assert.match(dockerfile, /io\.elevant\.web\.hr-demo-mode=\$\{NEXT_PUBLIC_HR_DEMO_MODE\}/);
  assert.match(dockerfile, /NEXT_PUBLIC_HR_DEMO_MODE=\$\{NEXT_PUBLIC_HR_DEMO_MODE\}/);
  assert.doesNotMatch(dockerfile, /backend-prototipo|database\//i);

  assert.match(certifier, /EXPECTED_HR_DEMO_MODE="dashboard-read-only"/);
  assert.match(certifier, /expect_label io\.elevant\.web\.hr-demo-mode/);
  assert.match(certifier, /bundle does not contain the connected HR dashboard/);
  assert.match(certifier, /still contains the retired synthetic-data banner/);
  assert.match(webCi, /document\["hrDemoMode"\] = "dashboard-read-only"/);
  assert.match(webCi, /expected\.add\("hrDemoMode"\)/);
  assert.match(webCi, /--build-arg NEXT_PUBLIC_HR_DEMO_MODE=dashboard-read-only/);

  assert.match(layout, /elevant-logo\.png/);
  assert.match(certifier, /AVIAM Web brand icon did not match the reviewed asset/);
  assert.doesNotMatch(certifier, /nginx -t|\/usr\/share\/nginx\/html|SPA entry/);
});

test('AVIAM uses a standalone Next server behind the existing CD endpoint contract', async () => {
  const [config, dockerfile, compose, packageJson] = await Promise.all([
    readFile(path.join(projectRoot, 'next.config.mjs'), 'utf8'),
    readFile(path.join(projectRoot, 'Dockerfile'), 'utf8'),
    readFile(path.join(projectRoot, 'compose.development.aviam-web.yml'), 'utf8'),
    readFile(path.join(projectRoot, 'package.json'), 'utf8'),
  ]);
  const scripts = JSON.parse(packageJson).scripts;
  assert.match(config, /output:\s*['"]standalone['"]/);
  assert.match(config, /outputFileTracingRoot:/);
  assert.match(config, /source: '\/index\.html', destination: '\/login'/);
  assert.match(dockerfile, /\.next\/standalone/);
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/);
  assert.doesNotMatch(dockerfile, /nginx|\/out\//i);
  assert.match(dockerfile, /USER 101:101/);
  assert.match(compose, /127\.0\.0\.1:18081:8080/);
  assert.match(compose, /\.next\/cache/);
  assert.doesNotMatch(scripts.build, /finalize-static-export|serve-export/);
  assert.doesNotMatch(scripts.start, /serve-export/);
});

test('health route returns the exact CD marker without caching', async () => {
  const { GET } = await import('../app/healthz/route.js');
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
});

test('the public asset directory cannot shadow the Next health route', async () => {
  await assert.rejects(
    access(path.join(projectRoot, 'public/healthz')),
    { code: 'ENOENT' },
  );
});

test('request nonce policy confines client traffic to the certified API and map tiles', async () => {
  const { buildContentSecurityPolicy } = await import('../src/config/securityHeaders.mjs');
  const policy = buildContentSecurityPolicy('https://api.elevant.test', 'nonce-123');
  assert.match(policy, /script-src 'self' 'nonce-nonce-123' 'strict-dynamic'/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.elevant\.test wss:\/\/api\.elevant\.test https:\/\/demotiles\.maplibre\.org https:\/\/tiles\.openfreemap\.org https:\/\/mesonet\.agron\.iastate\.edu https:\/\/gibs\.earthdata\.nasa\.gov;/);
  assert.match(policy, /img-src [^;]*https:\/\/gibs\.earthdata\.nasa\.gov/);
  assert.match(policy, /frame-ancestors 'none'/);
  // The print button frames the generated PDF as a blob: URL.
  assert.match(policy, /frame-src 'self' blob:/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.throws(() => buildContentSecurityPolicy('http://api.elevant.test', 'nonce-123'));
});
