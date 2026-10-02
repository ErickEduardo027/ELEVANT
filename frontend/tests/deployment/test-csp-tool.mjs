#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tool = path.join(repositoryRoot, "frontend/scripts/deployment/csp-tool.mjs");
const apiOrigin = "https://elevant-dev-api.example.ts.net";
const websocketOrigin = "wss://elevant-dev-api.example.ts.net";
const validPolicies = {
  "aviam-web": `default-src 'self'; connect-src 'self' ${apiOrigin} ${websocketOrigin} https://demotiles.maplibre.org https://tiles.openfreemap.org; frame-ancestors 'none'; object-src 'none'`,
  "public-web": `default-src 'self'; connect-src 'self' ${apiOrigin} ${websocketOrigin}; frame-ancestors 'none'; object-src 'none'`,
};

function validate(application, policy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "elevant-csp-test-"));
  try {
    const headers = path.join(root, "headers.txt");
    fs.writeFileSync(headers, `HTTP/1.1 200 OK\r\nContent-Security-Policy: ${policy}\r\n\r\n`, "latin1");
    return spawnSync(process.execPath, [
      tool, "validate", "--application", application, "--headers", headers, "--api-origin", apiOrigin,
    ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const application of Object.keys(validPolicies)) {
  test(`${application} accepts its exact reviewed connect-src`, () => {
    const result = validate(application, validPolicies[application]);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });

  test(`${application} rejects duplicate directive names case-insensitively`, () => {
    const result = validate(application, `${validPolicies[application]}; CONNECT-SRC 'self' ${apiOrigin}`);
    assert.notEqual(result.status, 0, "duplicate connect-src unexpectedly passed");
    assert.match(result.stderr, /duplicate CSP directive: connect-src/u);
  });
}

for (const source of ["https:", "wss:", "https://extra.example", "wss://socket.example"]) {
  test(`public-web rejects expanded connect-src ${source}`, () => {
    const policy = validPolicies["public-web"].replace(`${websocketOrigin};`, `${websocketOrigin} ${source};`);
    const result = validate("public-web", policy);
    assert.notEqual(result.status, 0, `expanded connect-src ${source} unexpectedly passed`);
  });
}

test("public-web rejects a websocket origin that does not match its certified API", () => {
  const result = validate("public-web", validPolicies["public-web"].replace(websocketOrigin, "wss://other.example.ts.net"));
  assert.notEqual(result.status, 0, "unrelated websocket origin unexpectedly passed");
});

test("aviam-web rejects a missing websocket origin", () => {
  const result = validate("aviam-web", validPolicies["aviam-web"].replace(` ${websocketOrigin}`, ""));
  assert.notEqual(result.status, 0, "missing websocket origin unexpectedly passed");
});

test("public-web rejects a missing API origin", () => {
  const result = validate("public-web", validPolicies["public-web"].replace(` ${apiOrigin}`, ""));
  assert.notEqual(result.status, 0, "missing API origin unexpectedly passed");
});

test("public-web rejects duplicate source expressions", () => {
  const policy = validPolicies["public-web"].replace("connect-src 'self'", "connect-src 'self' 'self'");
  const result = validate("public-web", policy);
  assert.notEqual(result.status, 0, "duplicate source unexpectedly passed");
  assert.match(result.stderr, /duplicate CSP source/u);
});

test("public-web rejects duplicate non-connect directives", () => {
  const result = validate("public-web", `${validPolicies["public-web"]}; DEFAULT-SRC 'none'`);
  assert.notEqual(result.status, 0, "duplicate default-src unexpectedly passed");
  assert.match(result.stderr, /duplicate CSP directive: default-src/u);
});

test("public-web rejects widened frame ancestry", () => {
  const result = validate("public-web", validPolicies["public-web"].replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  assert.notEqual(result.status, 0, "widened frame-ancestors unexpectedly passed");
});
