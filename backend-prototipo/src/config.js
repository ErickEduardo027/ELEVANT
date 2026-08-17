import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(sourceDirectory, '..');

export function getConfig(env = process.env) {
  return {
    host: env.PROTOTYPE_HOST || '0.0.0.0',
    port: Number(env.PROTOTYPE_PORT || 4310),
    dataDirectory: env.PROTOTYPE_DATA_DIR
      ? path.resolve(env.PROTOTYPE_DATA_DIR)
      : path.join(projectDirectory, 'data'),
  };
}
