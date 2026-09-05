#!/usr/bin/env node

const url = process.env.ELEVANT_HEALTHCHECK_URL ?? "http://127.0.0.1:3000/health";

try {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  const payload = await response.json();
  if (
    response.status !== 200 ||
    payload?.application !== "Elevant.PublicWeb" ||
    payload?.status !== "ok"
  ) {
    throw new Error("unexpected health response");
  }
} catch (error) {
  process.stderr.write(`Public Web health check failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
}
