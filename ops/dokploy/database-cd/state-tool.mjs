#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FIELDS = new Set([
  "status", "stage", "manifestDigest", "sourceCommit", "opsImage", "releaseImage",
  "databaseComposeSha256", "releaseComposeSha256", "messageCode", "updatedAt",
  "workflowUrl", "sourceRunId", "sourceRunAttempt",
]);
const DIGEST = /^(?:sha256:[0-9a-f]{64})?$/;
const COMMIT = /^(?:[0-9a-f]{40})?$/;
const SHA256_HEX = /^(?:[0-9a-f]{64})?$/;
const POSITIVE_INTEGER = /^(?:[1-9][0-9]*)?$/;

function fail(message) {
  process.stderr.write(`state-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const command = argv.shift();
  if (!["write", "get", "show"].includes(command)) fail("write, get, or show is required");
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

function load(file) {
  if (!fs.existsSync(file)) return {};
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("state path must be a regular, non-symlink file");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("state must be an object");
  if (Object.keys(value).some((key) => !FIELDS.has(key))) fail("state has an invalid shape");
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
  if (!SHA256_HEX.test(value.databaseComposeSha256 ?? "")) fail("state database Compose hash is invalid");
  if (!SHA256_HEX.test(value.releaseComposeSha256 ?? "")) fail("state release Compose hash is invalid");
  return value;
}

function atomicWrite(file, value) {
  const parent = path.dirname(file);
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) fail("state parent must be a non-symlink directory");
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

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "write") {
    atomicWrite(args.file, parsePairs(args.set));
  } else if (args.command === "get") {
    if (!FIELDS.has(args.field)) fail("--field is invalid");
    const value = load(args.file)[args.field] ?? "";
    if (typeof value !== "string") fail("state field is not a string");
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(load(args.file), null, 2)}\n`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "state operation failed");
}
