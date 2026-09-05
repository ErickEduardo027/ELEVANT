// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import nextConfig, { buildContentSecurityPolicy } from "../../next.config";

describe("Next Content-Security-Policy", () => {
  it("allows React debugging eval only during local development", () => {
    const policy = buildContentSecurityPolicy(
      "https://api.development.elevant.test",
      "development",
    );

    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' blob: 'unsafe-eval'",
    );
  });

  it("never enables eval in the production runtime policy", () => {
    const policy = buildContentSecurityPolicy(
      "https://api.development.elevant.test",
      "production",
    );

    expect(policy).toContain("script-src 'self' 'unsafe-inline' blob:");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("does not consume Next.js reserved NEXT_DEPLOYMENT_ID state", async () => {
    const revision = "a".repeat(40);
    vi.stubEnv("ELEVANT_DEPLOYMENT_ID", revision);
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "next-internal-build-state");
    vi.resetModules();

    try {
      const isolated = await import("../../next.config");
      expect(isolated.default.deploymentId).toBe(revision);
      expect(await isolated.default.generateBuildId?.()).toBe(revision);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("uses custom release provenance or the deterministic local fallback", async () => {
    const configured = process.env.ELEVANT_DEPLOYMENT_ID;
    expect(nextConfig.deploymentId).toBe(configured);
    expect(await nextConfig.generateBuildId?.()).toBe(
      configured ?? "local-development",
    );
  });
});
