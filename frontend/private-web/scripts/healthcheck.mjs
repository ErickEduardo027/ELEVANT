#!/usr/bin/env node

try {
  const response = await fetch('http://127.0.0.1:8080/healthz', {
    cache: 'no-store',
    signal: AbortSignal.timeout(4_000),
  });
  if (response.status !== 200 || await response.text() !== 'ok') {
    throw new Error('unexpected health response');
  }
} catch (error) {
  process.stderr.write(`AVIAM Web health check failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
}
