#!/usr/bin/env node

import { isIP } from "node:net";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) fail(`${name} is required.`);
  if (value !== value.trim()) fail(`${name} must not contain surrounding whitespace.`);
  return value;
}

function exactPattern(name, pattern, description) {
  const value = required(name);
  if (!pattern.test(value)) fail(`${name} must be ${description}.`);
  return value;
}

function httpsOrigin(name) {
  const value = required(name);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be an absolute HTTPS origin.`);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  const forbiddenHost =
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    isIP(hostname) !== 0 ||
    !hostname.includes(".");

  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username ||
    url.password ||
    forbiddenHost
  ) {
    fail(`${name} must be an exact HTTPS DNS origin without a trailing slash.`);
  }

  return value;
}

const revision = exactPattern(
  "VCS_REF",
  /^[0-9a-f]{40}$/,
  "a canonical 40-character lowercase Git commit",
);
const deploymentId = exactPattern(
  "ELEVANT_DEPLOYMENT_ID",
  /^[0-9a-f]{40}$/,
  "a canonical 40-character lowercase Git commit",
);
if (deploymentId !== revision) {
  fail("ELEVANT_DEPLOYMENT_ID must equal VCS_REF.");
}

exactPattern(
  "OCI_SOURCE",
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  "a canonical GitHub repository URL",
);
const created = required("OCI_CREATED");
if (
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(created) ||
  Number.isNaN(Date.parse(created))
) {
  fail("OCI_CREATED must be a UTC RFC 3339 timestamp.");
}

exactPattern(
  "REQUIRED_API_MANIFEST",
  /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[0-9a-f]{64}$/,
  "an immutable lowercase GHCR digest reference",
);
exactPattern(
  "OPENAPI_SHA256",
  /^sha256:[0-9a-f]{64}$/,
  "a sha256 OCI-style digest",
);
exactPattern("SOURCE_RUN_ID", /^[1-9][0-9]*$/, "a positive GitHub Actions run ID");

const siteOrigin = httpsOrigin("NEXT_PUBLIC_SITE_URL");
const apiOrigin = httpsOrigin("NEXT_PUBLIC_ELEVANT_API_URL");
const adapterOrigin = httpsOrigin("NEXT_PUBLIC_PROTOTYPE_API_URL");
if (adapterOrigin !== apiOrigin) {
  fail("NEXT_PUBLIC_PROTOTYPE_API_URL must equal NEXT_PUBLIC_ELEVANT_API_URL for Development releases.");
}
if (siteOrigin === apiOrigin) {
  fail("NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_ELEVANT_API_URL must be different origins.");
}
if (required("NEXT_PUBLIC_DEMO_FORM_MODE") !== "preview") {
  fail("NEXT_PUBLIC_DEMO_FORM_MODE must be preview for this Development release.");
}

process.stdout.write("PUBLIC_WEB_DEVELOPMENT_ENV_OK\n");
