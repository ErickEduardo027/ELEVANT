import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageDist = path.join(projectRoot, 'node_modules/maplibre-gl/dist');
// Since MapLibre 6.13 the worker is self-contained and maplibre-gl-shared.mjs is an empty,
// deprecated file that the package keeps until its next major version. It is still copied
// because the image certification serves and compares both files.
const assetNames = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

export async function copyMapLibreWorkerAssets(destination = path.join(projectRoot, 'public/assets/maplibre')) {
  await mkdir(destination, { recursive: true });
  await Promise.all(assetNames.map(name => copyFile(path.join(packageDist, name), path.join(destination, name))));
}

// The worker is served from the folder the assets are copied to, so every module it imports by a
// relative path must be one of them. Returns the imported specifiers the copy would leave behind.
export function findUncopiedWorkerImports(workerSource) {
  return [...workerSource.matchAll(/\b(?:from|import)\s*\(?\s*["'`](\.\.?\/[^"'`]+)["'`]/g)]
    .map(match => match[1])
    .filter(specifier => !assetNames.includes(specifier.replace(/^\.\//, '')));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyMapLibreWorkerAssets();
}
