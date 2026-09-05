import { afterEach, describe, expect, it, vi } from "vitest";

import { getPrototypeApiUrl } from "@/lib/prototype-api";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("temporary API adapter configuration", () => {
  it("uses an explicitly configured origin", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_PROTOTYPE_API_URL",
      "https://api.development.elevant.test",
    );

    expect(getPrototypeApiUrl()).toBe(
      "https://api.development.elevant.test",
    );
  });

  it("fails visibly instead of falling back to a local prototype", () => {
    vi.stubEnv("NEXT_PUBLIC_PROTOTYPE_API_URL", "");

    expect(() => getPrototypeApiUrl()).toThrow(
      /NEXT_PUBLIC_PROTOTYPE_API_URL is required/,
    );
  });

  it.each([
    "not-a-url",
    "https://api.development.elevant.test/path",
    "https://user:password@api.development.elevant.test",
  ])("rejects a non-origin value: %s", (value) => {
    vi.stubEnv("NEXT_PUBLIC_PROTOTYPE_API_URL", value);

    expect(() => getPrototypeApiUrl()).toThrow(/absolute HTTP\(S\) origin/);
  });
});
