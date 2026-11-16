import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Runs after `next build` (npm run build): what the production build must never carry in its chunks. Node built-ins
// only, because the image build runs it too (Dockerfile.dockerignore lists it).
// - The map lab is for development only: app/map-lab/page.jsx imports its loader inside the development branch,
//   which the production build drops with the import. A built chunk that names the loader or carries the lab's root
//   attribute (MAP_LAB_MARKER of src/features/maps/lab/MapLab.jsx) means the lab was bundled.
// - three travels in its own async chunk (PR M7, design J): no chunk of a route's first load may carry three's
//   WebGLRenderer. A route's first load is what its client reference manifest
//   (.next/server/app/**/page_client-reference-manifest.js) names for it, with the root main files and the polyfills
//   of .next/build-manifest.json. three's own messages and properties name the renderer, so minifying keeps the word.

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The words only the map lab's modules carry: the attribute on its root and the name of its loader module. */
export const MAP_LAB_NEEDLES = Object.freeze(['data-occ-map-lab', 'MapLabLoader']);

/** The built folders the check reads: the browser chunks and the server code. */
export const BUILT_ROOTS = Object.freeze(['.next/static', '.next/server']);

/** The word of three's renderer that no first-load chunk may carry. */
export const THREE_NEEDLE = 'WebGLRenderer';

const CLIENT_MANIFEST = 'page_client-reference-manifest.js';

/** Of `[{ file, source }]`, the files whose source carries one of `needles`, in the order given. */
export function findLabChunks(sources, needles = MAP_LAB_NEEDLES) {
  return sources.filter(({ source }) => needles.some(needle => source.includes(needle))).map(({ file }) => file);
}

/**
 * The routes a page_client-reference-manifest.js describes: the `globalThis.__RSC_MANIFEST` it writes (route →
 * manifest), evaluated in an empty context with no access to Node and returned as plain data.
 */
export function readRscManifest(source) {
  const context = vm.createContext({});
  vm.runInContext(source, context, { timeout: 1_000 });
  return JSON.parse(JSON.stringify(context.__RSC_MANIFEST ?? {}));
}

// 'static/chunks/x.js' from the forms a manifest uses: '/_next/static/chunks/x.js?dpl=…', 'static/chunks/x.js', or a
// module id before a colon.
function chunkFile(entry) {
  const [file] = entry.split('?');
  return file.slice(file.lastIndexOf(':') + 1).replace(/^\/?(?:_next\/)?/, '');
}

/**
 * The chunks the given route manifests load before anything else, as 'static/chunks/x.js', sorted and without repeats:
 * their entry files, the chunks of every client module they reference, and the build manifest's root main files and
 * polyfills. A client module marked `async` counts too: the flag means an async ES module (top-level await), which
 * still loads with the page; what loads later through import() is no client reference at all. Stylesheets and anything
 * outside static/ are left out.
 */
export function firstLoadChunks({ rscManifests = [], buildManifest = {} } = {}) {
  const files = new Set();
  const add = entry => {
    if (typeof entry !== 'string') return;
    const file = chunkFile(entry);
    if (file.startsWith('static/') && file.endsWith('.js')) files.add(file);
  };
  for (const manifest of rscManifests) {
    Object.values(manifest.entryJSFiles ?? {}).flat().forEach(add);
    Object.values(manifest.clientModules ?? {}).forEach(module => (module.chunks ?? []).forEach(add));
  }
  [...(buildManifest.rootMainFiles ?? []), ...(buildManifest.polyfillFiles ?? [])].forEach(add);
  return [...files].sort();
}

/** Of the `firstLoad` files, those whose source (`sources`: a Map or `[{ file, source }]`) carries the needle. */
export function findThreeInFirstLoad(sources, firstLoad, needle = THREE_NEEDLE) {
  const byFile = sources instanceof Map ? sources : new Map(sources.map(({ file, source }) => [file, source]));
  return firstLoad.filter(file => byFile.get(file)?.includes(needle) === true);
}

async function scriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await scriptFiles(file));
    // Source maps hold the original sources, dead branches included: only the code that runs is checked.
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(file);
  }
  return files;
}

/**
 * The 3D check of a built `.next` folder: no route's first load carries three's renderer, and (unless `requireThree`
 * is false) some browser chunk does, the 3D chunk OccMap loads later. It throws when no route of /admin-occ has a
 * client reference manifest, when a manifest names a chunk the build did not write, when a first-load chunk carries
 * the needle, or when no chunk does. Answers `{ routes, firstLoad, threeChunks }`: the routes checked, their distinct
 * first-load chunks and the built browser chunks that do carry the renderer (three's own, loaded later).
 */
export async function checkThreeFirstLoad(nextDir, { requireThree = true } = {}) {
  const manifestFiles = (await scriptFiles(path.join(nextDir, 'server', 'app')))
    .filter(file => path.basename(file) === CLIENT_MANIFEST);
  const routes = [];
  for (const file of manifestFiles) {
    for (const [route, manifest] of Object.entries(readRscManifest(await readFile(file, 'utf8')))) routes.push({ route, manifest });
  }
  if (!routes.some(({ route }) => route.startsWith('/admin-occ/'))) {
    throw new Error(`No client reference manifest of an /admin-occ route was found under ${nextDir}: run next build first.`);
  }
  const buildManifest = JSON.parse(await readFile(path.join(nextDir, 'build-manifest.json'), 'utf8'));
  const perRoute = routes.map(({ route, manifest }) => ({ route, files: firstLoadChunks({ rscManifests: [manifest], buildManifest }) }));
  const firstLoad = [...new Set(perRoute.flatMap(({ files }) => files))].sort();
  const sources = new Map();
  for (const file of firstLoad) {
    try {
      sources.set(file, await readFile(path.join(nextDir, file), 'utf8'));
    } catch {
      throw new Error(`A route's first load names ${file}, which the build did not write.`);
    }
  }
  const carrying = perRoute
    .map(({ route, files }) => ({ route, files: findThreeInFirstLoad(sources, files) }))
    .filter(({ files }) => files.length > 0);
  if (carrying.length > 0) {
    throw new Error(`three's ${THREE_NEEDLE} reached the first load of ${carrying.map(({ route, files }) => `${route} (${files.join(', ')})`).join('; ')}`);
  }
  let threeChunks = 0;
  for (const file of await scriptFiles(path.join(nextDir, 'static'))) {
    if ((await readFile(file, 'utf8')).includes(THREE_NEEDLE)) threeChunks += 1;
  }
  // OccMap loads the 3D chunk (PR M7): a build without it lost the 3D aircraft, or bundled three where the needle no
  // longer finds it.
  if (requireThree && threeChunks === 0) {
    throw new Error(`No built browser chunk carries three's ${THREE_NEEDLE}: the 3D aircraft chunk is missing.`);
  }
  return { routes: routes.length, firstLoad: firstLoad.length, threeChunks };
}

async function main() {
  const files = (await Promise.all(BUILT_ROOTS.map(root => scriptFiles(path.join(projectRoot, root))))).flat();
  if (files.length === 0) throw new Error('No built chunks were found: run next build first.');
  const sources = await Promise.all(files.map(async file => ({
    file: path.relative(projectRoot, file).split(path.sep).join('/'),
    source: await readFile(file, 'utf8'),
  })));
  const lab = findLabChunks(sources);
  if (lab.length > 0) {
    throw new Error(`The development-only map lab reached the production build: ${lab.join(', ')}`);
  }
  console.log(`PRIVATE_WEB_MAP_LAB_ABSENT_OK chunks=${files.length}`);
  const three = await checkThreeFirstLoad(path.join(projectRoot, '.next'));
  console.log(`PRIVATE_WEB_THREE_FIRST_LOAD_OK routes=${three.routes} firstLoad=${three.firstLoad} threeChunks=${three.threeChunks}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
