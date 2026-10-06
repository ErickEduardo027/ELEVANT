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
const tool = path.join(repositoryRoot, "frontend/scripts/deployment/web-compose-tool.mjs");
const profiles = {
  "aviam-web": path.join(repositoryRoot, "frontend/private-web/compose.development.aviam-web.yml"),
  "public-web": path.join(repositoryRoot, "frontend/public-web/compose.development.public-web.yml"),
};

function invoke(application, compose) {
  return spawnSync(process.execPath, [tool, "validate", "--application", application, "--compose", compose], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
}

function mutate(application, description, transform) {
  test(`${application} rejects ${description}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "elevant-compose-test-"));
    try {
      const source = fs.readFileSync(profiles[application], "utf8");
      const changed = transform(source);
      assert.notEqual(changed, source, "test mutation must alter the Compose source");
      const compose = path.join(root, "docker-compose.yml");
      fs.writeFileSync(compose, changed, "utf8");
      const result = invoke(application, compose);
      assert.notEqual(result.status, 0, `mutation unexpectedly passed:\n${result.stdout}${result.stderr}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const [application, compose] of Object.entries(profiles)) {
  test(`${application} real Compose renders and satisfies its closed runtime contract`, () => {
    const result = invoke(application, compose);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, new RegExp(`WEB_COMPOSE_VALID application=${application}`));
  });
}

mutate("aviam-web", "a second service", (source) => source.replace(
  "services:\n",
  `services:\n  unexpected:\n    image: "ghcr.io/elevant-ci/unexpected@sha256:${"1".repeat(64)}"\n`,
));
mutate("public-web", "a non-loopback port", (source) => source.replace("127.0.0.1:18082:3000", "0.0.0.0:18082:3000"));
mutate("aviam-web", "a SQL data network", (source) => source
  .replace("      - runtime\n", "      - runtime\n      - data\n")
  .replace("networks:\n  runtime:", "networks:\n  data:\n    external: true\n    name: elevant-dev-data\n  runtime:"));
mutate("public-web", "a writable root filesystem", (source) => source.replace("read_only: true", "read_only: false"));
mutate("aviam-web", "a root runtime user", (source) => source.replace('user: "101:101"', 'user: "0:0"'));
mutate("public-web", "retained Linux capabilities", (source) => source.replace("      - ALL", "      - NET_ADMIN"));
mutate("aviam-web", "disabled no-new-privileges", (source) => source.replace("no-new-privileges:true", "no-new-privileges:false"));
mutate("public-web", "a widened CPU limit", (source) => source.replace("cpus: 0.35", "cpus: 1.0"));
mutate("aviam-web", "a removed memory limit", (source) => source.replace("    mem_limit: 512m\n", ""));
mutate("aviam-web", "a missing writable Next cache", (source) => source.replace(
  "      - /app/frontend/private-web/.next/cache:rw,noexec,nosuid,nodev,size=128m,uid=101,gid=101,mode=0700\n",
  "",
));
mutate("public-web", "a removed PID limit", (source) => source.replace("    pids_limit: 256\n", ""));
mutate("aviam-web", "a disabled healthcheck", (source) => source.replace(
  "    healthcheck:\n      test:",
  "    healthcheck:\n      disable: true\n      test:",
));
mutate("public-web", "an altered healthcheck command", (source) => source.replace(
  '["CMD", "node", "/app/healthcheck.mjs"]',
  '["CMD", "node", "--version"]',
));
mutate("aviam-web", "Docker API socket delegation", (source) => source.replace(
  "    init: true\n",
  "    init: true\n    use_api_socket: true\n",
));
mutate("public-web", "volumes_from inheritance", (source) => source.replace(
  "    init: true\n",
  "    init: true\n    volumes_from:\n      - container:forbidden\n",
));
mutate("aviam-web", "a post_start lifecycle hook", (source) => source.replace(
  "    init: true\n",
  "    init: true\n    post_start:\n      - command: [\"/bin/true\"]\n",
));
mutate("public-web", "supplementary groups", (source) => source.replace(
  '    user: "1000:1000"\n',
  '    user: "1000:1000"\n    group_add:\n      - "999"\n',
));
mutate("aviam-web", "a custom OCI runtime", (source) => source.replace(
  "    init: true\n",
  "    init: true\n    runtime: runc\n",
));
mutate("public-web", "a command override", (source) => source.replace(
  "    init: true\n",
  "    init: true\n    command: [\"node\", \"--version\"]\n",
));
mutate("aviam-web", "an entrypoint override", (source) => source.replace(
  "    init: true\n",
  "    init: true\n    entrypoint: [\"/bin/sh\", \"-c\"]\n",
));
mutate("aviam-web", "user interpolation that renders to the reviewed default", (source) => source.replace(
  '    user: "101:101"',
  '    user: "${ELEVANT_TEST_USER:-101:101}"',
));
mutate("public-web", "port interpolation that renders to the reviewed default", (source) => source.replace(
  '    ports:\n      - "127.0.0.1:18082:3000"',
  '    ports:\n      - "${ELEVANT_TEST_BINDING:-127.0.0.1:18082:3000}"',
));
mutate("aviam-web", "the image placeholder moved into a comment", (source) => source.replace(
  '    image: "${ELEVANT_AVIAM_WEB_IMAGE:?Set an immutable GHCR AVIAM Web image including @sha256 digest}"',
  `    # \${ELEVANT_AVIAM_WEB_IMAGE:?Set an immutable GHCR AVIAM Web image including @sha256 digest}\n    image: "ghcr.io/elevant-ci/elevant-private-web@sha256:${"0".repeat(64)}"`,
));
mutate("public-web", "the image placeholder moved into a comment", (source) => source.replace(
  '    image: "${ELEVANT_PUBLIC_WEB_IMAGE:?Set an immutable GHCR Public Web image including an @sha256 digest}"',
  `    # \${ELEVANT_PUBLIC_WEB_IMAGE:?Set an immutable GHCR Public Web image including an @sha256 digest}\n    image: "ghcr.io/elevant-ci/elevant-public-web@sha256:${"0".repeat(64)}"`,
));
