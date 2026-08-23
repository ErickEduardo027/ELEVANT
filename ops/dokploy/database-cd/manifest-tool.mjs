#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const OCI_DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IMAGE_REF = /^(ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+)@(sha256:[0-9a-f]{64})$/;
const MIGRATION_ID = /^[0-9]{14}_[A-Za-z0-9_]+$/;
const RUN_NUMBER = /^[1-9][0-9]*$/;

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
    if (!["file", "expected-repository", "expected-ref", "ops-repository", "release-repository", "get"].includes(key)) {
      fail(`unsupported option: ${option}`);
    }
    if (Object.hasOwn(result, key)) fail(`duplicate option: ${option}`);
    result[key] = value;
  }
  for (const key of ["file", "expected-repository", "expected-ref", "ops-repository", "release-repository"]) {
    if (!result[key]) fail(`--${key} is required`);
  }
  return result;
}

function exactKeys(value, expected, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
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
  if (!match) throw new Error(`${location} must be a lowercase GHCR reference pinned by digest`);
  if (match[1] !== expectedRepository) throw new Error(`${location} uses an unexpected image repository`);
  return text;
}

function loadManifest(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("manifest must be a regular, non-symlink file");
  if (stat.size < 1 || stat.size > 1024 * 1024) throw new Error("manifest size must be between 1 byte and 1 MiB");
  const raw = fs.readFileSync(path);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw new Error("manifest must not contain a UTF-8 BOM");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  return JSON.parse(text);
}

function validate(args) {
  const manifest = exactKeys(loadManifest(args.file), [
    "schemaVersion", "environment", "source", "images", "compose", "database", "publishedAt",
  ], "$");
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be the integer 1");
  if (manifest.environment !== "Development") throw new Error("environment must be Development");

  const source = exactKeys(manifest.source, ["repository", "ref", "commit", "runId", "runAttempt", "workflowUrl"], "source");
  if (source.repository !== args["expected-repository"]) throw new Error("source.repository mismatch");
  if (source.ref !== args["expected-ref"]) throw new Error("source.ref mismatch");
  patterned(source.commit, COMMIT, "source.commit");
  const runId = patterned(source.runId, RUN_NUMBER, "source.runId");
  if (!Number.isSafeInteger(source.runAttempt) || source.runAttempt < 1) throw new Error("source.runAttempt must be a positive integer");
  const workflowUrl = stringValue(source.workflowUrl, "source.workflowUrl");
  if (workflowUrl !== `https://github.com/${args["expected-repository"]}/actions/runs/${runId}`) {
    throw new Error("source.workflowUrl is not canonical");
  }

  const images = exactKeys(manifest.images, ["ops", "release"], "images");
  imageReference(images.ops, args["ops-repository"], "images.ops");
  imageReference(images.release, args["release-repository"], "images.release");

  const compose = exactKeys(manifest.compose, ["databaseSha256", "releaseSha256"], "compose");
  patterned(compose.databaseSha256, SHA256_HEX, "compose.databaseSha256");
  patterned(compose.releaseSha256, SHA256_HEX, "compose.releaseSha256");

  const database = exactKeys(manifest.database, ["migrationIds", "migrationFingerprint", "modelFingerprint", "seedFingerprint"], "database");
  if (!Array.isArray(database.migrationIds) || database.migrationIds.length === 0) {
    throw new Error("database.migrationIds must be a non-empty array");
  }
  database.migrationIds.forEach((id, index) => patterned(id, MIGRATION_ID, `database.migrationIds[${index}]`));
  const sorted = [...database.migrationIds].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(database.migrationIds)) throw new Error("database.migrationIds must be sorted");
  if (new Set(database.migrationIds).size !== database.migrationIds.length) throw new Error("database.migrationIds must be unique");
  for (const key of ["migrationFingerprint", "modelFingerprint", "seedFingerprint"]) {
    patterned(database[key], OCI_DIGEST, `database.${key}`);
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
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new Error(`unknown field: ${field}`);
    }
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
