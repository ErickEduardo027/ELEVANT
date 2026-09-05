#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";

function fail(message) {
  process.stderr.write(`openapi-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("OpenAPI contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("OpenAPI contains an unsupported JSON value");
}

try {
  const argv = process.argv.slice(2);
  if (argv.length !== 3 || argv[0] !== "hash" || argv[1] !== "--file") fail("usage: openapi-tool hash --file PATH");
  const stat = fs.lstatSync(argv[2]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4 * 1024 * 1024) throw new Error("OpenAPI file is invalid");
  const raw = fs.readFileSync(argv[2]);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw new Error("OpenAPI must not contain a UTF-8 BOM");
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("OpenAPI root must be an object");
  const digest = crypto.createHash("sha256").update(canonicalJson(parsed)).digest("hex");
  process.stdout.write(`sha256:${digest}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : "OpenAPI hashing failed");
}
