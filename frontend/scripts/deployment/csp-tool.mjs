#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const MAX_HEADER_BYTES = 256 * 1024;
const EXPECTED_CONNECT = Object.freeze({
  "aviam-web": Object.freeze([
    "'self'",
    "https://demotiles.maplibre.org",
    "https://tiles.openfreemap.org",
  ]),
  "public-web": Object.freeze(["'self'"]),
});

function fail(message) {
  process.stderr.write(`csp-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv[0] !== "validate") fail("the validate command is required");
  const result = {};
  const allowed = new Set(["application", "headers", "api-origin"]);
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || value === undefined) fail("invalid arguments");
    const key = option.slice(2);
    if (!allowed.has(key)) fail(`unsupported option: ${option}`);
    if (Object.hasOwn(result, key)) fail(`duplicate option: ${option}`);
    result[key] = value;
  }
  for (const key of allowed) {
    if (!result[key]) fail(`--${key} is required`);
  }
  if (!Object.hasOwn(EXPECTED_CONNECT, result.application)) fail("unsupported application");
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalHttpsOrigin(value) {
  const parsed = new URL(value);
  assert(parsed.protocol === "https:", "API origin must use HTTPS");
  assert(parsed.username === "" && parsed.password === "", "API origin must not contain credentials");
  assert(parsed.pathname === "/" && parsed.search === "" && parsed.hash === "", "API origin must not contain a path, query or fragment");
  assert(parsed.origin === value, "API origin must be canonical and have no trailing slash");
  return value;
}

function readHeaders(file) {
  const absolute = path.resolve(file);
  const stat = fs.lstatSync(absolute);
  assert(stat.isFile() && !stat.isSymbolicLink(), "header input must be a regular, non-symlink file");
  assert(stat.size >= 1 && stat.size <= MAX_HEADER_BYTES, "header input has an invalid size");
  const raw = fs.readFileSync(absolute);
  assert(!raw.includes(0), "header input contains a NUL byte");
  const result = new Map();
  for (const rawLine of raw.toString("latin1").split(/\r?\n/u)) {
    if (rawLine === "" || /^HTTP\//iu.test(rawLine)) continue;
    const separator = rawLine.indexOf(":");
    if (separator < 1) continue;
    const name = rawLine.slice(0, separator).trim().toLowerCase();
    assert(/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(name), "response contains an invalid header name");
    const value = rawLine.slice(separator + 1).trim();
    const values = result.get(name) || [];
    values.push(value);
    result.set(name, values);
  }
  return result;
}

function parsePolicy(value) {
  const directives = new Map();
  for (const rawDirective of value.split(";")) {
    const tokens = rawDirective.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens.shift().toLowerCase();
    assert(/^[a-z][a-z0-9-]*$/u.test(name), `invalid CSP directive name: ${name}`);
    assert(!directives.has(name), `duplicate CSP directive: ${name}`);
    assert(new Set(tokens).size === tokens.length, `duplicate CSP source in ${name}`);
    directives.set(name, tokens);
  }
  return directives;
}

function equalSet(actual, expected) {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

function validate(args) {
  const apiOrigin = canonicalHttpsOrigin(args["api-origin"]);
  const headers = readHeaders(args.headers);
  const policies = headers.get("content-security-policy") || [];
  assert(policies.length === 1, "response must contain exactly one Content-Security-Policy header");
  const directives = parsePolicy(policies[0]);
  const websocketOrigin = apiOrigin.replace(/^https:/u, "wss:");
  const expectedConnect = [...EXPECTED_CONNECT[args.application], apiOrigin, websocketOrigin];
  const connectSources = directives.get("connect-src") || [];
  assert(equalSet(connectSources, expectedConnect), `${args.application} connect-src must contain exactly its certified API and approved sources`);
  assert(equalSet(directives.get("frame-ancestors") || [], ["'none'"]), "frame-ancestors must be exactly 'none'");
}

try {
  const args = parseArgs(process.argv.slice(2));
  validate(args);
  process.stdout.write(`CSP_VALID application=${args.application}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : "CSP validation failed");
}
