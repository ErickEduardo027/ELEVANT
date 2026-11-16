import { describe, expect, it } from "vitest";

import { GET } from "@/app/health/route";

describe("Public Web health route", () => {
  it("reports only the web process and disables response caching", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      application: "Elevant.PublicWeb",
      status: "ok",
    });
  });
});
