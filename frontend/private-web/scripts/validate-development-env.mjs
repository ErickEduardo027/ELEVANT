#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

const VARIABLE_NAMES = [
  'VITE_ELEVANT_API_URL',
  'VITE_PROTOTYPE_API_URL',
];
const REQUIRED_HR_DEMO_MODE = 'dashboard-read-only';

export class DevelopmentEnvironmentError extends Error {}

function fail(message) {
  throw new DevelopmentEnvironmentError(message);
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || normalized.startsWith('127.');
}

export function parseApiOrigin(name, value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${name} is required.`);
  }

  if (value !== value.trim()) {
    fail(`${name} must not contain surrounding whitespace.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be an absolute URL.`);
  }

  if (parsed.protocol !== 'https:') {
    fail(`${name} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    fail(`${name} must not contain credentials.`);
  }
  if (isLoopbackHostname(parsed.hostname)) {
    fail(`${name} must not target localhost or a loopback address.`);
  }
  const normalizedHostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(normalizedHostname) !== 0) {
    fail(`${name} must use the Development API DNS name, not an IP literal.`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail(`${name} must be an origin only, without a path, query, or fragment.`);
  }
  if (value !== parsed.origin) {
    fail(`${name} must be the exact origin without a trailing slash.`);
  }

  return parsed.origin;
}

export function validateDevelopmentEnvironment(environment = process.env) {
  const origins = Object.fromEntries(
    VARIABLE_NAMES.map((name) => [name, parseApiOrigin(name, environment[name])]),
  );

  if (origins.VITE_ELEVANT_API_URL !== origins.VITE_PROTOTYPE_API_URL) {
    fail(
      'VITE_ELEVANT_API_URL and VITE_PROTOTYPE_API_URL must use the same HTTPS origin.',
    );
  }

  if (environment.VITE_HR_DEMO_MODE !== REQUIRED_HR_DEMO_MODE) {
    fail(`VITE_HR_DEMO_MODE must equal ${REQUIRED_HR_DEMO_MODE}.`);
  }

  return Object.freeze({
    apiOrigin: origins.VITE_ELEVANT_API_URL,
    hrDemoMode: REQUIRED_HR_DEMO_MODE,
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = validateDevelopmentEnvironment();
    process.stdout.write(
      `PRIVATE_WEB_DEVELOPMENT_ENV_OK origin=${result.apiOrigin} hr_demo_mode=${result.hrDemoMode}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`private_web_environment: ERROR: ${message}\n`);
    process.exitCode = 1;
  }
}
