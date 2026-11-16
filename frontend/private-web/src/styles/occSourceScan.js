// Node only: reads the source tree for the style guards (occStyleGuard.test.js).
// Nothing that runs in the browser may import this module.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

// What paints inside the OCC frame: the routes of /admin-occ and the shell that wraps them.
export const OCC_ENTRY_POINTS = Object.freeze(['app/admin-occ', 'src/features/admin-occ/AdminOccLayout.jsx']);

// The root layout: its stylesheets load on every page, the OCC frame included.
export const ROOT_LAYOUT = 'app/layout.jsx';

// Files that are listed but whose imports are not followed. RoleLayout is the switch between departments:
// it imports every department's shell, and under /admin-occ it mounts only AdminOccLayout, which is an
// entry point of its own. Following it would hand the OCC bridge the classes of Contracts, Finance,
// Human Resources and Superadmin.
export const OCC_SCAN_STOPS = Object.freeze(['src/app/RoleLayout.jsx']);

const SCRIPT_FILE = /\.(?:js|jsx|mjs)$/;
const SOURCE_FILE = /\.(?:js|jsx|mjs|css)$/;
const TEST_FILE = /\.test\.[a-z]+$/;
const RESOLVE_SUFFIXES = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx'];
// `import … from`, `export … from`, a side-effect `import '…'` and a dynamic `import('…')`.
const IMPORT_SPECIFIER = /\b(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const toPosix = path => path.split(sep).join('/');
const isFile = path => existsSync(path) && statSync(path).isFile();

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    });
}

// Relative specifiers and the `@/` alias of jsconfig.json; a package name resolves to nothing.
function resolveImport(root, importer, specifier) {
  let base;
  if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier);
  else if (specifier.startsWith('@/')) base = resolve(root, 'src', specifier.slice(2));
  else return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    if (isFile(base + suffix)) return base + suffix;
  }
  return null;
}

/**
 * Every file an entry point reaches through static imports, re-exports and `import()`, without test files.
 * Stylesheets are listed and not parsed. Paths are relative to `root` and use `/` on every platform.
 */
export function importClosure(entryPoints, { root = process.cwd(), stops = [] } = {}) {
  const stopped = new Set(stops.map(stop => resolve(root, stop)));
  const queue = entryPoints
    .map(entry => resolve(root, entry))
    .flatMap(entry => (statSync(entry).isDirectory() ? filesUnder(entry) : [entry]))
    .filter(file => !TEST_FILE.test(file));
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!SCRIPT_FILE.test(file) || stopped.has(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
      const target = resolveImport(root, file, match[1] ?? match[2]);
      if (target !== null && !TEST_FILE.test(target) && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].map(file => toPosix(relative(root, file))).sort();
}

/** The files mounted inside the OCC frame. */
export function occMountedFiles(root = process.cwd()) {
  return importClosure(OCC_ENTRY_POINTS, { root, stops: OCC_SCAN_STOPS });
}

/** The project stylesheets that the root layout imports, in import order; a package's stylesheet is left out. */
export function globalStylesheets(root = process.cwd()) {
  const layout = resolve(root, ROOT_LAYOUT);
  return [...readFileSync(layout, 'utf8').matchAll(IMPORT_SPECIFIER)]
    .map(match => resolveImport(root, layout, match[1] ?? match[2]))
    .filter(file => file !== null && file.endsWith('.css'))
    .map(file => toPosix(relative(root, file)));
}

/** The scripts and stylesheets of a folder, without test files. */
export function sourceFilesUnder(folder, root = process.cwd()) {
  return filesUnder(resolve(root, folder))
    .filter(file => SOURCE_FILE.test(file) && !TEST_FILE.test(file))
    .map(file => toPosix(relative(root, file)))
    .sort();
}

/** The text of a file given by its path relative to `root`. */
export function readSource(file, root = process.cwd()) {
  return readFileSync(resolve(root, file), 'utf8');
}
