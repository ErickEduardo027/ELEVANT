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
