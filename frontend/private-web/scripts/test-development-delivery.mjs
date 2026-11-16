import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('the map chunk check reports a chunk that carries the map-lab marker and accepts clean chunks', async () => {
  const { MAP_LAB_NEEDLES, BUILT_ROOTS, findLabChunks } = await import('./verify-map-chunks.mjs');
  assert.deepEqual(findLabChunks([
    { file: '.next/static/chunks/app.js', source: 'self.__next_f.push([1,"shell"])' },
    { file: '.next/static/chunks/lab.js', source: 'e.jsx("div",{"data-occ-map-lab":"v1","data-department":"occ"})' },
    { file: '.next/server/app/map-lab/page.js', source: 'Promise.resolve().then(()=>r("./MapLabLoader"))' },
  ]), ['.next/static/chunks/lab.js', '.next/server/app/map-lab/page.js']);
  assert.deepEqual(findLabChunks([
    { file: '.next/static/chunks/maps.js', source: 'const MAPLIBRE_WORKER_URL="/assets/maplibre/maplibre-gl-worker.mjs"' },
    { file: '.next/server/app/map-lab/page.js', source: '(0,n.notFound)()' },
  ]), []);
  assert.deepEqual(BUILT_ROOTS, ['.next/static', '.next/server']);

  // The words are the lab's own, and the lab is imported only inside the development branch of its route.
  const [lab, loader, page, packageJson, dockerignore] = await Promise.all([
    readFile(path.join(projectRoot, 'src/features/maps/lab/MapLab.jsx'), 'utf8'),
    readFile(path.join(projectRoot, 'app/map-lab/MapLabLoader.jsx'), 'utf8'),
    readFile(path.join(projectRoot, 'app/map-lab/page.jsx'), 'utf8'),
    readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    readFile(path.join(projectRoot, 'Dockerfile.dockerignore'), 'utf8'),
  ]);
  assert.deepEqual(MAP_LAB_NEEDLES, ['data-occ-map-lab', 'MapLabLoader']);
  assert.match(lab, /^export const MAP_LAB_MARKER = 'data-occ-map-lab';$/m);
  assert.match(loader, /import\('\.\.\/\.\.\/src\/features\/maps\/lab\/MapLab'\)/);
  assert.match(page, /if \(process\.env\.NODE_ENV === 'development'\) \{\n\s+const \{ default: MapLabLoader \} = await import\('\.\/MapLabLoader'\);/);
  assert.match(page, /^\s+notFound\(\);$/m);
  assert.doesNotMatch(page, /^import .*(?:MapLab|maps\/lab)/m, 'The route imports the lab inside its development branch only');
  // Every build runs the check after the worker check, and the image build context ships the script.
  assert.match(JSON.parse(packageJson).scripts.build, /verify-maplibre-worker\.mjs && node \.\/scripts\/verify-map-chunks\.mjs$/);
  assert.match(dockerignore, /^!frontend\/private-web\/scripts\/verify-map-chunks\.mjs$/m);
});

// A client reference manifest as next build writes it next to each page: one route per file.
const rscManifestSource = (route, manifest) => [
  'globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};',
  `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = ${JSON.stringify(manifest)};`,
].join('\n');

const OCC_ROUTE = '/admin-occ/dashboard/page';
const OCC_ROUTE_MANIFEST = {
  moduleLoading: { prefix: '', crossOrigin: 'none' },
  clientModules: {
    '[project]/frontend/private-web/node_modules/next/dist/esm/client/components/layout-router.js': {
      id: 10183, name: '*', chunks: ['/_next/static/chunks/0a-shell.js?dpl=0123abcd', '/_next/static/chunks/0b-app.js'], async: false,
    },
    '[project]/frontend/private-web/src/features/maps/core/OccMap.jsx': {
      id: 7, name: '*', chunks: ['/_next/static/chunks/0c-map.js'], async: false,
    },
  },
  entryCSSFiles: { '[project]/frontend/private-web/app/layout': [{ path: 'static/chunks/0e-style.css', inlined: false }] },
  entryJSFiles: {
    '[project]/frontend/private-web/app/layout': ['static/chunks/0a-shell.js', 'static/chunks/0b-app.js'],
    '[project]/frontend/private-web/app/admin-occ/dashboard/page': ['static/chunks/0a-shell.js', 'static/chunks/0f-page.js'],
  },
};
const BUILD_MANIFEST = {
  pages: { '/_app': [] },
  polyfillFiles: ['static/chunks/0p-polyfills.js'],
  rootMainFiles: ['static/chunks/0m-main.js', 'static/chunks/turbopack-0t.js'],
};
const OCC_FIRST_LOAD = [
  'static/chunks/0a-shell.js', 'static/chunks/0b-app.js', 'static/chunks/0c-map.js', 'static/chunks/0f-page.js',
  'static/chunks/0m-main.js', 'static/chunks/0p-polyfills.js', 'static/chunks/turbopack-0t.js',
];

test('the first-load chunks of a route are its entry files, its client modules and the root main files', async () => {
  const { firstLoadChunks, readRscManifest } = await import('./verify-map-chunks.mjs');
  const manifests = readRscManifest(rscManifestSource(OCC_ROUTE, OCC_ROUTE_MANIFEST));
  assert.deepEqual(Object.keys(manifests), [OCC_ROUTE]);
  assert.deepEqual(manifests[OCC_ROUTE], OCC_ROUTE_MANIFEST);
  // The deployment query and the /_next/ prefix go; each chunk is listed once, in order; stylesheets stay out.
  assert.deepEqual(firstLoadChunks({ rscManifests: Object.values(manifests), buildManifest: BUILD_MANIFEST }), OCC_FIRST_LOAD);
  // An async client module (top-level await) loads with the page as well; a module id before a colon is dropped, and
  // files outside static/ are not browser chunks.
  assert.deepEqual(firstLoadChunks({
    rscManifests: [{
      clientModules: { awaited: { chunks: ['/_next/static/chunks/0z-awaited.js'], async: true },
        webpack: { chunks: ['123', '123:static/chunks/0w-webpack.js', 'static/css/0s.css'], async: false } },
      entryJSFiles: { server: ['server/app/page.js'] },
    }],
  }), ['static/chunks/0w-webpack.js', 'static/chunks/0z-awaited.js']);
  assert.deepEqual(firstLoadChunks(), []);
  // The manifest runs in an empty context: it reaches neither require nor process.
  assert.throws(() => readRscManifest("require('node:fs')"), /require is not defined/);
  assert.throws(() => readRscManifest('process.exit(1)'), /process is not defined/);
  assert.deepEqual(readRscManifest('const nothing = 1;'), {});
});

test('the 3D check fails when a first-load chunk carries WebGLRenderer or no chunk does, and passes when three sits in an async chunk; a build without OCC route manifests is an error', async () => {
  const { THREE_NEEDLE, checkThreeFirstLoad, findThreeInFirstLoad } = await import('./verify-map-chunks.mjs');
  assert.equal(THREE_NEEDLE, 'WebGLRenderer');
  // The word is three's own: its renderer's messages carry it, so a minified chunk still does.
  assert.match(await readFile(path.join(projectRoot, 'node_modules/three/build/three.module.js'), 'utf8'), /'WebGLRenderer: /);
  const sources = [
    { file: 'static/chunks/0a-shell.js', source: 'self.__next_f.push([1,"shell"])' },
    { file: 'static/chunks/0d-three.js', source: 'console.warn("THREE.WebGLRenderer: Context Lost.")' },
  ];
  assert.deepEqual(findThreeInFirstLoad(sources, ['static/chunks/0a-shell.js']), []);
  assert.deepEqual(findThreeInFirstLoad(sources, ['static/chunks/0d-three.js', 'static/chunks/0a-shell.js']), ['static/chunks/0d-three.js']);
  assert.deepEqual(findThreeInFirstLoad(new Map(sources.map(({ file, source }) => [file, source])), ['static/chunks/0d-three.js']),
    ['static/chunks/0d-three.js']);

  const nextDir = await mkdtemp(path.join(tmpdir(), 'elevant-next-'));
  const write = async (file, content) => {
    await mkdir(path.dirname(path.join(nextDir, file)), { recursive: true });
    await writeFile(path.join(nextDir, file), content);
  };
  try {
    await write('build-manifest.json', JSON.stringify(BUILD_MANIFEST));
    for (const file of OCC_FIRST_LOAD) await write(file, 'self.chunk = 1;');
    // three's own chunk: on disk, named by no manifest, fetched later through import().
    await write('static/chunks/0d-three.js', 'console.warn("THREE.WebGLRenderer: Context Lost.");');
    await write('server/app/admin-occ/dashboard/page_client-reference-manifest.js', rscManifestSource(OCC_ROUTE, OCC_ROUTE_MANIFEST));
    await write('server/app/login/page_client-reference-manifest.js',
      rscManifestSource('/login/page', { clientModules: {}, entryJSFiles: { login: ['static/chunks/0a-shell.js'] } }));
    assert.deepEqual(await checkThreeFirstLoad(nextDir), { routes: 2, firstLoad: OCC_FIRST_LOAD.length, threeChunks: 1 });

    // A map chunk that carried three's renderer would break the dashboard's first load.
    await write('static/chunks/0c-map.js', 'const renderer = new WebGLRenderer({ canvas });');
    await assert.rejects(checkThreeFirstLoad(nextDir),
      /three's WebGLRenderer reached the first load of \/admin-occ\/dashboard\/page \(static\/chunks\/0c-map\.js\)/);
    await write('static/chunks/0c-map.js', 'self.chunk = 1;');

    // OccMap loads the 3D chunk (PR M7): a build without any chunk that carries three's renderer lost it.
    await rm(path.join(nextDir, 'static/chunks/0d-three.js'));
    await assert.rejects(checkThreeFirstLoad(nextDir), /No built browser chunk carries three's WebGLRenderer/);
    assert.deepEqual(await checkThreeFirstLoad(nextDir, { requireThree: false }),
      { routes: 2, firstLoad: OCC_FIRST_LOAD.length, threeChunks: 0 });
    await write('static/chunks/0d-three.js', 'console.warn("THREE.WebGLRenderer: Context Lost.");');

    // A manifest that names a chunk the build did not write.
    await rm(path.join(nextDir, 'static/chunks/0f-page.js'));
    await assert.rejects(checkThreeFirstLoad(nextDir), /names static\/chunks\/0f-page\.js, which the build did not write/);
    await write('static/chunks/0f-page.js', 'self.chunk = 1;');

    // Without a manifest of an /admin-occ route there is nothing to check: an error, not a pass.
    await rm(path.join(nextDir, 'server/app/admin-occ'), { recursive: true });
    await assert.rejects(checkThreeFirstLoad(nextDir), /No client reference manifest of an \/admin-occ route was found/);
  } finally {
    await rm(nextDir, { recursive: true, force: true });
  }

  // Every build runs the check: the build ends with verify-map-chunks.mjs, whose main calls it on .next.
  const script = await readFile(path.join(projectRoot, 'scripts/verify-map-chunks.mjs'), 'utf8');
  assert.match(script, /const three = await checkThreeFirstLoad\(path\.join\(projectRoot, '\.next'\)\);/);
  assert.match(script, /PRIVATE_WEB_THREE_FIRST_LOAD_OK routes=\$\{three\.routes\} firstLoad=\$\{three\.firstLoad\} threeChunks=\$\{three\.threeChunks\}/);
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
