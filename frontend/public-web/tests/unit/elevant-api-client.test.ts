import { afterEach, describe, expect, it, vi } from "vitest";

import { createPublicWebApiClient } from "@/lib/elevant-api";

const ping = {
  application: "Elevant.Api",
  status: "ok",
  environment: "Testing",
  timestampUtc: "2026-09-05T12:00:00Z",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public web API client seam", () => {
  it("uses the literal Next public API URL without consulting mock auth", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_ELEVANT_API_URL",
      "https://public-api.elevant.test",
    );
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(ping), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const client = createPublicWebApiClient({ fetch: fetchMock });

    await expect(client.getSystemPing()).resolves.toEqual(ping);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      new URL("https://public-api.elevant.test/api/v1/system/ping"),
    );
  });

  it("fails visibly when the Next public API URL is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "");

    expect(() => createPublicWebApiClient()).toThrow(
      /NEXT_PUBLIC_ELEVANT_API_URL/,
    );
  });
});
