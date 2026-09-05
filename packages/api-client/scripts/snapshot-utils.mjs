import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const expectedMetadataKeys = [
  "apiImage",
  "sourceCommit",
  "sourceRunId",
  "swaggerPath",
];

export const packageRoot = resolve(import.meta.dirname, "..");
export const snapshotPath = resolve(packageRoot, "openapi", "elevant-v1.json");
export const sourceMetadataPath = resolve(packageRoot, "openapi", "source.json");

export async function readJson(path) {
  let contents;

  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new Error("Unable to read the OpenAPI JSON input.");
  }

  try {
    return JSON.parse(contents);
  } catch {
    throw new Error("The OpenAPI input is not valid JSON.");
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }

  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalJson(value));
}

export async function validateTrackedSnapshot() {
  const [snapshot, metadata] = await Promise.all([
    readJson(snapshotPath),
    readJson(sourceMetadataPath),
  ]);

  const metadataKeys = Object.keys(metadata).sort();
  if (canonicalStringify(metadataKeys) !== canonicalStringify(expectedMetadataKeys)) {
    throw new Error("OpenAPI provenance metadata has an unexpected shape.");
  }

  if (!/^[0-9a-f]{40}$/.test(metadata.sourceCommit)) {
    throw new Error("OpenAPI provenance has an invalid source commit.");
  }

  if (!/^\d+$/.test(metadata.sourceRunId)) {
    throw new Error("OpenAPI provenance has an invalid source run ID.");
  }

  if (
    !/^ghcr\.io\/erickeduardo027\/elevant-api@sha256:[0-9a-f]{64}$/.test(
      metadata.apiImage,
    )
  ) {
    throw new Error("OpenAPI provenance has an invalid immutable API image.");
  }

  if (metadata.swaggerPath !== "/swagger/v1/swagger.json") {
    throw new Error("OpenAPI provenance has an invalid Swagger path.");
  }

  if (
    snapshot?.info?.version !== "v1" ||
    snapshot?.paths?.["/api/v1/system/ping"]?.get?.operationId !==
      "GetSystemPing"
  ) {
    throw new Error("The tracked OpenAPI snapshot is not the expected v1 contract.");
  }

  return snapshot;
}
