import nextEnv from '@next/env';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const { loadEnvConfig } = nextEnv;
const command = process.argv[2];
if (!['dev', 'build', 'start', 'typegen'].includes(command)) {
  process.stderr.write('Usage: node scripts/run-next.mjs <dev|build|start|typegen> [args...]\n');
  process.exit(2);
}

loadEnvConfig(projectRoot, command === 'dev');

const publicEnvironment = [
  ['NEXT_PUBLIC_ELEVANT_API_URL', 'VITE_ELEVANT_API_URL'],
  ['NEXT_PUBLIC_PROTOTYPE_API_URL', 'VITE_PROTOTYPE_API_URL'],
  ['NEXT_PUBLIC_HR_DEMO_MODE', 'VITE_HR_DEMO_MODE'],
  ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY'],
  ['NEXT_PUBLIC_FLIGHT_MAP_STYLE_LIGHT', 'VITE_FLIGHT_MAP_STYLE_LIGHT'],
  ['NEXT_PUBLIC_FLIGHT_MAP_STYLE_DARK', 'VITE_FLIGHT_MAP_STYLE_DARK'],
  ['NEXT_PUBLIC_POSITIONS_MAP_STYLE_LIGHT', 'VITE_POSITIONS_MAP_STYLE_LIGHT'],
  ['NEXT_PUBLIC_POSITIONS_MAP_STYLE_DARK', 'VITE_POSITIONS_MAP_STYLE_DARK'],
];

for (const [nextName, legacyName] of publicEnvironment) {
  if (!process.env[nextName] && process.env[legacyName]) {
    process.env[nextName] = process.env[legacyName];
  }
}

const nextCli = path.join(projectRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const result = spawnSync(process.execPath, [nextCli, command, ...process.argv.slice(3)], {
  cwd: projectRoot,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? '1' },
  stdio: 'inherit',
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
