import { resolve } from "node:path";
import {
  canonicalStringify,
  readJson,
  validateTrackedSnapshot,
} from "./snapshot-utils.mjs";

const source = process.argv[2];

if (!source || process.argv.length !== 3) {
  console.error("Usage: npm run check:openapi -- <JSON file or HTTP(S) URL>");
  process.exit(2);
}

async function readCandidate(input) {
  if (!/^https?:\/\//i.test(input)) {
    return readJson(resolve(process.cwd(), input));
  }

  const url = new URL(input);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The OpenAPI URL must use HTTP or HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("The OpenAPI URL must not contain credentials.");
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Unable to retrieve the supplied OpenAPI URL.");
  }

  if (!response.ok) {
    throw new Error(
      `The supplied OpenAPI URL returned HTTP ${response.status}.`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error("The supplied OpenAPI response is not valid JSON.");
  }
}

try {
  const [expected, actual] = await Promise.all([
    validateTrackedSnapshot(),
    readCandidate(source),
  ]);

  if (canonicalStringify(expected) !== canonicalStringify(actual)) {
    throw new Error("OpenAPI contract drift detected.");
  }

  console.log("OpenAPI contract matches the tracked snapshot.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "OpenAPI check failed.");
  process.exit(1);
}
