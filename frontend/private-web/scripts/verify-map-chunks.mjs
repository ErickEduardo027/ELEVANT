import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs after `next build` (npm run build): what the production build must never carry in its chunks. Node built-ins
// only, because the image build runs it too (Dockerfile.dockerignore lists it).
// - The map lab is for development only: app/map-lab/page.jsx imports its loader inside the development branch,
//   which the production build drops with the import. A built chunk that names the loader or carries the lab's root
//   attribute (MAP_LAB_MARKER of src/features/maps/lab/MapLab.jsx) means the lab was bundled.
// PR M7 adds its rule here: no WebGLRenderer in the first load of an OCC route.

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The words only the map lab's modules carry: the attribute on its root and the name of its loader module. */
export const MAP_LAB_NEEDLES = Object.freeze(['data-occ-map-lab', 'MapLabLoader']);

/** The built folders the check reads: the browser chunks and the server code. */
export const BUILT_ROOTS = Object.freeze(['.next/static', '.next/server']);

/** Of `[{ file, source }]`, the files whose source carries one of `needles`, in the order given. */
export function findLabChunks(sources, needles = MAP_LAB_NEEDLES) {
  return sources.filter(({ source }) => needles.some(needle => source.includes(needle))).map(({ file }) => file);
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
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
