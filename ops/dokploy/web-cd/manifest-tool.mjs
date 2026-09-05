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
const HTTP_PATH = /^\/(?:[A-Za-z0-9._~:@!$&'()*+,;=%-]+\/?)*$/;
const BUNDLE_FILES = ["compose.development.web.yml", "manifest.json"];
const APPLICATIONS = {
  "aviam-web": { containerPort: 8080, healthPath: "/healthz", smokePaths: ["/healthz", "/", "/dashboard"] },
  "public-web": { containerPort: 3000, healthPath: "/health", smokePaths: ["/health", "/", "/login"] },
};

function fail(message) {
  process.stderr.write(`manifest-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv[0] !== "validate") fail("the validate command is required");
  const result = {};
  const allowed = new Set([
    "file", "bundle-root", "application", "expected-repository", "expected-ref",
    "web-repository", "api-manifest-repository", "api-image-repository", "get",
  ]);
  for (let index = 1; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || value === undefined) fail("invalid arguments");
    const key = option.slice(2);
    if (!allowed.has(key)) fail(`unsupported option: ${option}`);
    if (Object.hasOwn(result, key)) fail(`duplicate option: ${option}`);
    result[key] = value;
  }
  for (const key of [
    "file", "bundle-root", "application", "expected-repository", "expected-ref",
    "web-repository", "api-manifest-repository", "api-image-repository",
  ]) {
    if (!result[key]) fail(`--${key} is required`);
  }
  if (!Object.hasOwn(APPLICATIONS, result.application)) fail("unsupported application");
  return result;
}

function exactKeys(value, expected, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`invalid keys at ${location}`);
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
  if (!match || match[1] !== expectedRepository) throw new Error(`${location} must use the expected lowercase GHCR repository pinned by digest`);
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
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 1024 * 1024) throw new Error(`invalid bundle payload: ${name}`);
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function validate(args) {
  loadBundle(args);
  const manifest = exactKeys(loadJson(args.file, "manifest"), [
    "schemaVersion", "environment", "application", "source", "images", "compose",
    "api", "build", "endpoints", "publishedAt",
  ], "$");
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion must be the integer 1");
  if (manifest.environment !== "Development") throw new Error("environment must be Development");
  if (manifest.application !== args.application) throw new Error("application mismatch");

  const source = exactKeys(manifest.source, ["repository", "ref", "commit", "runId", "runAttempt", "workflowUrl"], "source");
  if (source.repository !== args["expected-repository"]) throw new Error("source.repository mismatch");
  if (source.ref !== args["expected-ref"]) throw new Error("source.ref mismatch");
  patterned(source.commit, COMMIT, "source.commit");
  const runId = patterned(source.runId, RUN_NUMBER, "source.runId");
  if (!Number.isSafeInteger(source.runAttempt) || source.runAttempt < 1) throw new Error("source.runAttempt must be a positive integer");
  if (source.workflowUrl !== `https://github.com/${args["expected-repository"]}/actions/runs/${runId}`) throw new Error("source.workflowUrl is not canonical");

  const images = exactKeys(manifest.images, ["web"], "images");
  imageReference(images.web, args["web-repository"], "images.web");

  const compose = exactKeys(manifest.compose, ["webSha256"], "compose");
  patterned(compose.webSha256, SHA256_HEX, "compose.webSha256");
  if (sha256File(path.join(args["bundle-root"], "compose.development.web.yml")) !== compose.webSha256) throw new Error("web Compose payload hash mismatch");

  const api = exactKeys(manifest.api, ["requiredManifest", "requiredRunId", "requiredImage", "openApiSha256"], "api");
  imageReference(api.requiredManifest, args["api-manifest-repository"], "api.requiredManifest");
  patterned(api.requiredRunId, RUN_NUMBER, "api.requiredRunId");
  imageReference(api.requiredImage, args["api-image-repository"], "api.requiredImage");
  patterned(api.openApiSha256, OCI_DIGEST, "api.openApiSha256");

  const build = exactKeys(manifest.build, ["configurationSha256"], "build");
  patterned(build.configurationSha256, OCI_DIGEST, "build.configurationSha256");

  const endpoints = exactKeys(manifest.endpoints, ["containerPort", "healthPath", "smokePaths"], "endpoints");
  const expected = APPLICATIONS[args.application];
  if (endpoints.containerPort !== expected.containerPort) throw new Error(`endpoints.containerPort must equal ${expected.containerPort}`);
  if (endpoints.healthPath !== expected.healthPath) throw new Error(`endpoints.healthPath must equal ${expected.healthPath}`);
  if (!Array.isArray(endpoints.smokePaths)) throw new Error("endpoints.smokePaths must be an array");
  endpoints.smokePaths.forEach((value, index) => patterned(value, HTTP_PATH, `endpoints.smokePaths[${index}]`));
  if (JSON.stringify(endpoints.smokePaths) !== JSON.stringify(expected.smokePaths)) throw new Error("endpoints.smokePaths does not match the reviewed application contract");

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
