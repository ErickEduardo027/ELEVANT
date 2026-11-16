import { writeFile } from "node:fs/promises";
import {
  canonicalJsonSha256,
  snapshotPath,
  sourceDescriptorPath,
} from "./snapshot-utils.mjs";

const url = process.argv[2];
if (!url || process.argv.length !== 3 ||
    !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/swagger\/v1\/swagger\.json$/.test(url)) {
  console.error("Usage: npm run refresh:openapi -- http://127.0.0.1:<port>/swagger/v1/swagger.json");
  process.exit(2);
}

const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Local API returned HTTP ${response.status}.`);
const document = await response.json();
if (document?.info?.version !== "v1" ||
    document?.paths?.["/api/v1/system/ping"]?.get?.operationId !== "GetSystemPing") {
  throw new Error("The local API did not expose the expected v1 contract.");
}

const digest = canonicalJsonSha256(document);
await writeFile(snapshotPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
await writeFile(sourceDescriptorPath, `${JSON.stringify({
  schemaVersion: 1,
  openApiSha256: digest,
  swaggerPath: "/swagger/v1/swagger.json",
}, null, 2)}\n`, "utf8");
console.log(`Captured reviewed local OpenAPI contract ${digest}`);
