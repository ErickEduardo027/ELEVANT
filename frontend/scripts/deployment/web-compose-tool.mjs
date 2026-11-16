#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const SYNTHETIC_DIGEST = "0".repeat(64);
const PROJECT_NAME = "elevant-web-compose-validation";
const MAX_COMPOSE_BYTES = 256 * 1024;

const PROFILES = Object.freeze({
  "aviam-web": Object.freeze({
    service: "aviam-web",
    imageEnvironment: "ELEVANT_AVIAM_WEB_IMAGE",
    imageInterpolation: "${ELEVANT_AVIAM_WEB_IMAGE:?Set an immutable GHCR AVIAM Web image including @sha256 digest}",
    image: `ghcr.io/elevant-ci/elevant-private-web@sha256:${SYNTHETIC_DIGEST}`,
    user: "101:101",
    hostPort: "18081",
    containerPort: 8080,
    network: "elevant-dev-aviam-web-runtime",
    cpus: 0.35,
    memory: 512 * 1024 * 1024,
    pids: 256,
    healthcheck: Object.freeze({
      test: Object.freeze(["CMD", "node", "/app/healthcheck.mjs"]),
      interval: "15s",
      timeout: "5s",
      retries: 4,
      startPeriod: "20s",
    }),
    stopGracePeriod: "30s",
    tmpfs: Object.freeze([
      "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=101,gid=101,mode=1700",
      "/app/frontend/private-web/.next/cache:rw,noexec,nosuid,nodev,size=128m,uid=101,gid=101,mode=0700",
    ]),
    environment: null,
  }),
  "public-web": Object.freeze({
    service: "public-web",
    imageEnvironment: "ELEVANT_PUBLIC_WEB_IMAGE",
    imageInterpolation: "${ELEVANT_PUBLIC_WEB_IMAGE:?Set an immutable GHCR Public Web image including an @sha256 digest}",
    image: `ghcr.io/elevant-ci/elevant-public-web@sha256:${SYNTHETIC_DIGEST}`,
    user: "1000:1000",
    hostPort: "18082",
    containerPort: 3000,
    network: "elevant-dev-public-web-runtime",
    cpus: 0.35,
    memory: 512 * 1024 * 1024,
    pids: 256,
    healthcheck: Object.freeze({
      test: Object.freeze(["CMD", "node", "/app/healthcheck.mjs"]),
      interval: "15s",
      timeout: "5s",
      retries: 4,
      startPeriod: "20s",
    }),
    stopGracePeriod: "30s",
    tmpfs: Object.freeze([
      "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=1000,gid=1000,mode=1700",
      "/app/frontend/public-web/.next/cache:rw,noexec,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700",
    ]),
    environment: Object.freeze({
      HOSTNAME: "0.0.0.0",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
      PORT: "3000",
    }),
  }),
});

function fail(message) {
  process.stderr.write(`web-compose-tool: ERROR: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv[0] !== "validate") fail("the validate command is required");
  const result = {};
  const allowed = new Set(["application", "compose"]);
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
  if (!Object.hasOwn(PROFILES, result.application)) fail("unsupported application");
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function closedKeys(value, allowed, location) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${location} must be an object`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(unexpected.length === 0, `${location} contains unexpected keys: ${unexpected.join(", ")}`);
}

function regularComposeFile(file) {
  const absolute = path.resolve(file);
  const stat = fs.lstatSync(absolute);
  assert(stat.isFile() && !stat.isSymbolicLink(), "Compose input must be a regular, non-symlink file");
  assert(stat.size >= 1 && stat.size <= MAX_COMPOSE_BYTES, "Compose input has an invalid size");
  return absolute;
}

function validateRawInterpolation(file, profile) {
  const bytes = fs.readFileSync(file);
  assert(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), "Compose input must not contain a UTF-8 BOM");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const pieces = source.split(profile.imageInterpolation);
  assert(pieces.length === 2, `Compose must contain exactly one ${profile.imageEnvironment} image placeholder`);
  assert(!`${pieces[0]}${pieces[1]}`.includes("$"), "Compose interpolation is forbidden outside the exact image placeholder");
}

function composeEnvironment(profile) {
  const result = {};
  const inherited = [
    "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "COMSPEC",
    "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
    "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
    "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432",
    "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST",
    "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "XDG_CONFIG_HOME", "TMP", "TEMP", "TMPDIR",
  ];
  for (const key of inherited) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  result[profile.imageEnvironment] = profile.image;
  return result;
}

function renderCompose(file, profile, interpolate = true) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "elevant-web-compose-"));
  const emptyEnvironment = path.join(temporaryRoot, "empty.env");
  try {
    fs.writeFileSync(emptyEnvironment, "", { encoding: "utf8", mode: 0o600 });
    const docker = process.env.ELEVANT_WEB_COMPOSE_DOCKER_BIN || "docker";
    const arguments_ = [
      "compose",
      "--env-file", emptyEnvironment,
      "--project-directory", path.dirname(file),
      "-p", PROJECT_NAME,
      "-f", file,
      "config",
      "--format", "json",
    ];
    if (!interpolate) arguments_.push("--no-interpolate", "--no-env-resolution", "--no-path-resolution");
    const result = spawnSync(docker, arguments_, {
      cwd: path.dirname(file),
      encoding: "utf8",
      env: composeEnvironment(profile),
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = result.stderr.trim().slice(0, 1000);
      throw new Error(`docker compose config failed${detail ? `: ${detail}` : ""}`);
    }
    assert(result.stdout.length <= 2 * 1024 * 1024, "rendered Compose model is too large");
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function validateImagePlaceholderLocation(model, profile) {
  assert(model && typeof model === "object" && !Array.isArray(model), "uninterpolated Compose model must be an object");
  assert(model.services && typeof model.services === "object" && !Array.isArray(model.services), "uninterpolated services must be an object");
  assert(same(Object.keys(model.services), [profile.service]), `uninterpolated model must contain only ${profile.service}`);
  assert(model.services[profile.service]?.image === profile.imageInterpolation, `the exact ${profile.imageEnvironment} placeholder must be service.image`);
}

function validateModel(model, profile) {
  assert(model && typeof model === "object" && !Array.isArray(model), "rendered Compose model must be an object");
  closedKeys(model, ["name", "networks", "services"], "Compose model");
  assert(model.name === PROJECT_NAME, "rendered Compose project name is unexpected");

  assert(model.services && typeof model.services === "object" && !Array.isArray(model.services), "services must be an object");
  assert(same(Object.keys(model.services), [profile.service]), `exactly the ${profile.service} service is required`);
  const service = model.services[profile.service];
  const serviceKeys = [
    "cap_drop", "command", "cpus", "entrypoint", "healthcheck", "image", "init",
    "logging", "mem_limit", "networks", "pids_limit", "ports", "pull_policy",
    "read_only", "restart", "security_opt", "stop_grace_period", "tmpfs", "user",
  ];
  if (profile.environment !== null) serviceKeys.push("environment");
  closedKeys(service, serviceKeys, `${profile.service} service`);
  assert(service.image === profile.image, "service image was not rendered from the synthetic immutable digest");
  assert(!Object.hasOwn(service, "command") || service.command === null, "runtime command override is forbidden");
  assert(!Object.hasOwn(service, "entrypoint") || service.entrypoint === null, "runtime entrypoint override is forbidden");
  assert(service.pull_policy === "always", "pull_policy must remain always for normal operator deployments");
  assert(service.init === true, "init must be enabled");
  assert(service.read_only === true, "root filesystem must be read-only");
  assert(service.user === profile.user, `runtime user must be exactly ${profile.user}`);
  assert(!["", "0", "0:0", "root", "root:root"].includes(String(service.user).toLowerCase()), "runtime user must be non-root");
  assert(same(service.cap_drop, ["ALL"]), "cap_drop must contain exactly ALL");
  assert(same(service.security_opt, ["no-new-privileges:true"]), "no-new-privileges must be the only security option");

  assert(service.cpus === profile.cpus, `CPU limit must equal ${profile.cpus}`);
  assert(Number(service.mem_limit) === profile.memory, `memory limit must equal ${profile.memory} bytes`);
  assert(service.pids_limit === profile.pids, `PID limit must equal ${profile.pids}`);

  assert(Array.isArray(service.ports) && service.ports.length === 1, "exactly one loopback port binding is required");
  closedKeys(service.ports[0], ["mode", "host_ip", "target", "published", "protocol"], "published port");
  assert(same(service.ports[0], {
    mode: "ingress",
    host_ip: "127.0.0.1",
    target: profile.containerPort,
    published: profile.hostPort,
    protocol: "tcp",
  }), `port must be exactly 127.0.0.1:${profile.hostPort}:${profile.containerPort}/tcp`);

  assert(same(Object.keys(service.networks || {}), ["runtime"]), "service must join only the runtime network");
  assert(same(Object.keys(model.networks || {}), ["runtime"]), "Compose must define only the runtime network");
  const network = model.networks.runtime;
  closedKeys(network, ["external", "ipam", "name"], "runtime network");
  assert(network?.external === true, "runtime network must be external");
  assert(network.name === profile.network, `runtime network must be exactly ${profile.network}`);
  assert(same(network.ipam, {}), "runtime network IPAM must not be customized");

  assert(service.healthcheck && typeof service.healthcheck === "object", "healthcheck is required");
  closedKeys(service.healthcheck, ["interval", "retries", "start_period", "test", "timeout"], "healthcheck");
  assert(same(service.healthcheck.test, profile.healthcheck.test), "healthcheck command is unexpected");
  assert(service.healthcheck.interval === profile.healthcheck.interval, "healthcheck interval is unexpected");
  assert(service.healthcheck.timeout === profile.healthcheck.timeout, "healthcheck timeout is unexpected");
  assert(service.healthcheck.retries === profile.healthcheck.retries, "healthcheck retries are unexpected");
  assert(service.healthcheck.start_period === profile.healthcheck.startPeriod, "healthcheck start period is unexpected");

  assert(service.restart === "unless-stopped", "restart policy must be unless-stopped");
  assert(service.stop_grace_period === profile.stopGracePeriod, "stop grace period is unexpected");
  assert(same(service.tmpfs, profile.tmpfs), "tmpfs mounts differ from the reviewed profile");
  closedKeys(service.logging, ["driver", "options"], "logging");
  closedKeys(service.logging.options, ["max-file", "max-size"], "logging options");
  assert(same(service.logging, { driver: "json-file", options: { "max-file": "5", "max-size": "10m" } }), "bounded json-file logging is required");
  if (profile.environment === null) {
    assert(!Object.hasOwn(service, "environment"), "AVIAM runtime must not receive environment variables");
  } else {
    assert(same(service.environment, profile.environment), "Public Web runtime environment differs from the reviewed profile");
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const profile = PROFILES[args.application];
  const composeFile = regularComposeFile(args.compose);
  validateRawInterpolation(composeFile, profile);
  validateImagePlaceholderLocation(renderCompose(composeFile, profile, false), profile);
  validateModel(renderCompose(composeFile, profile), profile);
  process.stdout.write(`WEB_COMPOSE_VALID application=${args.application}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : "Compose validation failed");
}
