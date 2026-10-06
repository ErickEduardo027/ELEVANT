import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageDist = path.join(projectRoot, 'node_modules/maplibre-gl/dist');
const assetNames = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

export async function copyMapLibreWorkerAssets(destination = path.join(projectRoot, 'public/assets/maplibre')) {
  await mkdir(destination, { recursive: true });
  await Promise.all(assetNames.map(name => copyFile(path.join(packageDist, name), path.join(destination, name))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyMapLibreWorkerAssets();
}
