#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const OCI_DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RUN_NUMBER = /^[1-9][0-9]*$/;
const IMAGE_REF = /^(ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+)@(sha256:[0-9a-f]{64})$/;
const BUNDLE_FILES = ["compose.development.api.yml", "manifest.json"];
const ENDPOINTS = {
  containerPort: 8080,
  livenessPath: "/health",
  readinessPath: "/health/ready",
  pingPath: "/api/v1/system/ping",
  swaggerPath: "/swagger/v1/swagger.json",
};

function fail(message) {
  process.stderr.write(`manifest-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv[0] !== "validate") fail("the validate command is required");
  const result = {};
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || value === undefined) fail("invalid arguments");
    const key = option.slice(2);
    if (!["file", "bundle-root", "expected-repository", "expected-ref", "api-repository", "database-manifest-repository", "get"].includes(key)) {
      fail(`unsupported option: ${option}`);
    }
    if (Object.hasOwn(result, key)) fail(`duplicate option: ${option}`);
    result[key] = value;
  }
  for (const key of ["file", "bundle-root", "expected-repository", "expected-ref", "api-repository", "database-manifest-repository"]) {
    if (!result[key]) fail(`--${key} is required`);
  }
  return result;
}

function exactKeys(value, expected, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`invalid keys at ${location}`);
  }
  return value;
}

function stringValue(value, location) {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${location} must be a non-empty string without control characters`);
  }
  return value;
}

function patterned(value, pattern, location) {
  const text = stringValue(value, location);
  if (!pattern.test(text)) throw new Error(`${location} has an invalid format`);
  return text;
}

function imageReference(value, expectedRepository, location) {
  const text = stringValue(value, location);
  const match = IMAGE_REF.exec(text);
  if (!match || match[1] !== expectedRepository) {
    throw new Error(`${location} must use the expected lowercase GHCR repository pinned by digest`);
  }
  return text;
}

function loadJson(file, description) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${description} must be a regular, non-symlink file`);
  if (stat.size < 1 || stat.size > 1024 * 1024) throw new Error(`${description} size must be between 1 byte and 1 MiB`);
  const raw = fs.readFileSync(file);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw new Error(`${description} must not contain a UTF-8 BOM`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
}

function loadBundle(args) {
  const rootStat = fs.lstatSync(args["bundle-root"]);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("bundle root must be a non-symlink directory");
  if (JSON.stringify(fs.readdirSync(args["bundle-root"]).sort()) !== JSON.stringify(BUNDLE_FILES)) {
    throw new Error("bundle root must contain exactly the two protocol payloads");
  }
  if (path.resolve(args.file) !== path.resolve(args["bundle-root"], "manifest.json")) {
    throw new Error("--file must identify manifest.json inside the bundle root");
  }
  for (const name of BUNDLE_FILES) {
    const stat = fs.lstatSync(path.resolve(args["bundle-root"], name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024 * 1024) {
      throw new Error(`invalid bundle payload: ${name}`);
    }
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function validate(args) {
  loadBundle(args);
  const manifest = exactKeys(loadJson(args.file, "manifest"), [
    "schemaVersion", "environment", "source", "images", "compose", "database", "endpoints", "publishedAt",
  ], "$");
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be the integer 1");
  if (manifest.environment !== "Development") throw new Error("environment must be Development");

  const source = exactKeys(manifest.source, ["repository", "ref", "commit", "runId", "runAttempt", "workflowUrl"], "source");
  if (source.repository !== args["expected-repository"]) throw new Error("source.repository mismatch");
  if (source.ref !== args["expected-ref"]) throw new Error("source.ref mismatch");
  patterned(source.commit, COMMIT, "source.commit");
  const runId = patterned(source.runId, RUN_NUMBER, "source.runId");
  if (!Number.isSafeInteger(source.runAttempt) || source.runAttempt < 1) throw new Error("source.runAttempt must be a positive integer");
  if (source.workflowUrl !== `https://github.com/${args["expected-repository"]}/actions/runs/${runId}`) {
    throw new Error("source.workflowUrl is not canonical");
  }

  const images = exactKeys(manifest.images, ["api"], "images");
  imageReference(images.api, args["api-repository"], "images.api");

  const compose = exactKeys(manifest.compose, ["apiSha256"], "compose");
  patterned(compose.apiSha256, SHA256_HEX, "compose.apiSha256");
  if (sha256File(path.join(args["bundle-root"], "compose.development.api.yml")) !== compose.apiSha256) {
    throw new Error("API Compose payload hash mismatch");
  }

  const database = exactKeys(manifest.database, ["requiredManifest", "requiredRunId", "migrationFingerprint", "modelFingerprint"], "database");
  imageReference(database.requiredManifest, args["database-manifest-repository"], "database.requiredManifest");
  patterned(database.requiredRunId, RUN_NUMBER, "database.requiredRunId");
  patterned(database.migrationFingerprint, OCI_DIGEST, "database.migrationFingerprint");
  patterned(database.modelFingerprint, OCI_DIGEST, "database.modelFingerprint");

  const endpoints = exactKeys(manifest.endpoints, Object.keys(ENDPOINTS), "endpoints");
  for (const [key, expected] of Object.entries(ENDPOINTS)) {
    if (endpoints[key] !== expected) throw new Error(`endpoints.${key} must equal ${JSON.stringify(expected)}`);
  }

  const publishedAt = stringValue(manifest.publishedAt, "publishedAt");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(publishedAt) || Number.isNaN(Date.parse(publishedAt))) {
    throw new Error("publishedAt must be an RFC3339 UTC timestamp");
  }
  return manifest;
}

function lookup(value, field) {
  let current = value;
  for (const part of field.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) throw new Error(`unknown field: ${field}`);
    current = current[part];
  }
  return current;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const manifest = validate(args);
  if (args.get) {
    const value = lookup(manifest, args.get);
    process.stdout.write(`${typeof value === "object" ? JSON.stringify(value) : String(value)}\n`);
  } else {
    process.stdout.write("VALID\n");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "manifest validation failed");
}
