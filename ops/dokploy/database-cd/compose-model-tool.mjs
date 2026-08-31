#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

function fail(message) {
  process.stderr.write(`compose-model-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length !== 3 || argv[0] !== "hash" || argv[1] !== "--file") {
    fail("usage: compose-model-tool hash --file PATH");
  }
  return argv[2];
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("model contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  throw new Error("model contains an unsupported JSON value");
}

try {
  const file = parseArgs(process.argv.slice(2));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("model must be a regular, non-symlink file");
  }
  if (stat.size < 1 || stat.size > 16 * 1024 * 1024) {
    throw new Error("model size must be between 1 byte and 16 MiB");
  }
  const model = JSON.parse(fs.readFileSync(file, "utf8"));
  const digest = crypto.createHash("sha256").update(canonicalJson(model)).digest("hex");
  process.stdout.write(`${digest}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : "Compose model hashing failed");
}
