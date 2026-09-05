import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/validate-development-env.mjs");
const revision = "a".repeat(40);
const validEnvironment = {
  VCS_REF: revision,
  ELEVANT_DEPLOYMENT_ID: revision,
  OCI_SOURCE: "https://github.com/example/elevant",
  OCI_CREATED: "2026-09-05T12:00:00Z",
  REQUIRED_API_MANIFEST: `ghcr.io/example/elevant-api-release-manifest@sha256:${"b".repeat(64)}`,
  OPENAPI_SHA256: `sha256:${"c".repeat(64)}`,
  SOURCE_RUN_ID: "123456",
  NEXT_PUBLIC_SITE_URL: "https://public-web.development.elevant.test",
  NEXT_PUBLIC_ELEVANT_API_URL: "https://api.development.elevant.test",
  NEXT_PUBLIC_PROTOTYPE_API_URL: "https://api.development.elevant.test",
  NEXT_PUBLIC_DEMO_FORM_MODE: "preview",
};

function validate(overrides: Record<string, string | undefined> = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...validEnvironment,
    ...overrides,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[name];
  }
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env,
  });
}

describe("Development release environment validator", () => {
  it("accepts a complete immutable release configuration", () => {
    const result = validate();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PUBLIC_WEB_DEVELOPMENT_ENV_OK");
  });

  it("rejects a localhost API origin", () => {
    const result = validate({
      NEXT_PUBLIC_ELEVANT_API_URL: "http://localhost:4310",
      NEXT_PUBLIC_PROTOTYPE_API_URL: "http://localhost:4310",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_ELEVANT_API_URL");
  });

  it("rejects an IPv6 loopback API origin", () => {
    const result = validate({
      NEXT_PUBLIC_ELEVANT_API_URL: "https://[::1]",
      NEXT_PUBLIC_PROTOTYPE_API_URL: "https://[::1]",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_ELEVANT_API_URL");
  });

  it("rejects surrounding whitespace in an otherwise valid origin", () => {
    const result = validate({
      NEXT_PUBLIC_ELEVANT_API_URL: " https://api.development.elevant.test",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must not contain surrounding whitespace");
  });

  it("rejects a temporary adapter that differs from the certified API", () => {
    const result = validate({
      NEXT_PUBLIC_PROTOTYPE_API_URL: "https://another-api.elevant.test",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "NEXT_PUBLIC_PROTOTYPE_API_URL must equal NEXT_PUBLIC_ELEVANT_API_URL",
    );
  });

  it("rejects a deployment ID unrelated to the source commit", () => {
    const result = validate({ ELEVANT_DEPLOYMENT_ID: "d".repeat(40) });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ELEVANT_DEPLOYMENT_ID must equal VCS_REF");
  });

  it("ignores Next.js reserved NEXT_DEPLOYMENT_ID state", () => {
    const result = validate({ NEXT_DEPLOYMENT_ID: "next-internal-build-state" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PUBLIC_WEB_DEVELOPMENT_ENV_OK");
  });
});
