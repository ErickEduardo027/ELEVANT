#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FIELDS = new Set([
  "status", "stage", "manifestDigest", "sourceCommit", "sourceRunId", "sourceRunAttempt",
  "apiImage", "apiComposeSha256", "databaseManifest", "databaseRunId",
  "migrationFingerprint", "modelFingerprint", "rollbackStatus", "messageCode",
  "updatedAt", "workflowUrl",
]);
const DIGEST = /^(?:sha256:[0-9a-f]{64})?$/;
const COMMIT = /^(?:[0-9a-f]{40})?$/;
const SHA256_HEX = /^(?:[0-9a-f]{64})?$/;
const POSITIVE_INTEGER = /^(?:[1-9][0-9]*)?$/;
const FINGERPRINT = /^(?:sha256:[0-9a-f]{64})?$/;
const IMAGE_REF = /^(?:ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64})?$/;

function fail(message) {
  process.stderr.write(`state-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const command = argv.shift();
  if (!["write", "get", "show", "validate-database-state"].includes(command)) fail("unsupported command");
  const result = { command, set: [] };
  while (argv.length > 0) {
    const option = argv.shift();
    const value = argv.shift();
    if (value === undefined) fail(`${option} requires a value`);
    if (option === "--set") result.set.push(value);
    else if (option === "--file") result.file = value;
    else if (option === "--field") result.field = value;
    else fail(`unsupported option: ${option}`);
  }
  if (!result.file) fail("--file is required");
  return result;
}

function load(file, allowedFields = FIELDS) {
  if (!fs.existsSync(file)) return {};
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("state path must be a regular, non-symlink file");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("state must be an object");
  if (Object.keys(value).some((key) => !allowedFields.has(key))) fail("state has an invalid shape");
  return value;
}

function parsePairs(pairs) {
  const value = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator < 1) fail("--set values must use key=value");
    const key = pair.slice(0, separator);
    const item = pair.slice(separator + 1);
    if (!FIELDS.has(key)) fail(`unsupported state field: ${key}`);
    if (/[\u0000-\u001f]/.test(item)) fail(`state field contains a control character: ${key}`);
    value[key] = item;
  }
  if (!["running", "succeeded", "failed", "adopted"].includes(value.status)) fail("state status is invalid");
  if (!DIGEST.test(value.manifestDigest ?? "")) fail("state manifest digest is invalid");
  if (!COMMIT.test(value.sourceCommit ?? "")) fail("state source commit is invalid");
  if (!POSITIVE_INTEGER.test(value.sourceRunId ?? "")) fail("state source run ID is invalid");
  if (!POSITIVE_INTEGER.test(value.sourceRunAttempt ?? "")) fail("state source run attempt is invalid");
  if (!SHA256_HEX.test(value.apiComposeSha256 ?? "")) fail("state API Compose hash is invalid");
  if (!IMAGE_REF.test(value.apiImage ?? "")) fail("state API image is invalid");
  if (!IMAGE_REF.test(value.databaseManifest ?? "")) fail("state database manifest is invalid");
  if (!POSITIVE_INTEGER.test(value.databaseRunId ?? "")) fail("state database run ID is invalid");
  if (!FINGERPRINT.test(value.migrationFingerprint ?? "") || !FINGERPRINT.test(value.modelFingerprint ?? "")) fail("state database fingerprint is invalid");
  if (!["", "not-required", "succeeded", "failed"].includes(value.rollbackStatus ?? "")) fail("state rollback status is invalid");
  return value;
}

function atomicWrite(file, value) {
  const parent = path.dirname(file);
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("state parent must be a non-symlink directory");
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${Date.now()}`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, Object.keys(value).sort())}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") {
      const directoryDescriptor = fs.openSync(parent, "r");
      try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

function validateDatabaseState(file) {
  const allowed = new Set([
    "status", "stage", "manifestDigest", "sourceCommit", "opsImage", "releaseImage",
    "databaseComposeSha256", "releaseComposeSha256", "messageCode", "updatedAt",
    "workflowUrl", "sourceRunId", "sourceRunAttempt",
  ]);
  const value = load(file, allowed);
  if (value.status !== "succeeded" || value.stage !== "complete") fail("database state is not a completed promotion");
  if (!/^sha256:[0-9a-f]{64}$/.test(value.manifestDigest ?? "")) fail("database state manifest digest is invalid");
  if (!/^[1-9][0-9]*$/.test(value.sourceRunId ?? "")) fail("database state run ID is invalid");
  process.stdout.write(`${value.manifestDigest}\t${value.sourceRunId}\n`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "write") atomicWrite(args.file, parsePairs(args.set));
  else if (args.command === "get") {
    if (!FIELDS.has(args.field)) fail("--field is invalid");
    const value = load(args.file)[args.field] ?? "";
    if (typeof value !== "string") fail("state field is not a string");
    process.stdout.write(`${value}\n`);
  } else if (args.command === "show") process.stdout.write(`${JSON.stringify(load(args.file), null, 2)}\n`);
  else validateDatabaseState(args.file);
} catch (error) {
  fail(error instanceof Error ? error.message : "state operation failed");
}
