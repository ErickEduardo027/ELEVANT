#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function fail(message) {
  process.stderr.write(`env-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parse() {
  const argv = process.argv.slice(2);
  if (argv.length !== 7 || argv[0] !== "set" || argv[1] !== "--file" || argv[3] !== "--key" || argv[5] !== "--value") {
    fail("usage: env-tool set --file PATH --key KEY --value VALUE");
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(argv[4])) fail("invalid key");
  if (!/^ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+@sha256:[0-9a-f]{64}$/.test(argv[6])) {
    fail("value must be an immutable lowercase GHCR image reference");
  }
  return { file: argv[2], key: argv[4], value: argv[6] };
}

try {
  const { file, key, value } = parse();
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("environment path must be a regular, non-symlink file");
  const original = fs.readFileSync(file, "utf8");
  const lines = original.split(/\n/);
  let count = 0;
  const updated = lines.map((line) => {
    const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!clean.startsWith(`${key}=`)) return clean;
    count += 1;
    return `${key}=\"${value}\"`;
  });
  if (count !== 1) throw new Error(`environment must define ${key} exactly once`);
  const parent = path.dirname(file);
  const temporary = path.join(parent, `.${path.basename(file)}.${process.pid}.${Date.now()}`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, updated.join("\n"), "utf8");
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
} catch (error) {
  fail(error instanceof Error ? error.message : "environment update failed");
}
