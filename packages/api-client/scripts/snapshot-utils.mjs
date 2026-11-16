import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const expectedDescriptorKeys = [
  "openApiSha256",
  "schemaVersion",
  "swaggerPath",
];

export const openApiDescriptorSchemaVersion = 1;

export const packageRoot = resolve(import.meta.dirname, "..");
export const snapshotPath = resolve(packageRoot, "openapi", "elevant-v1.json");
export const sourceDescriptorPath = resolve(packageRoot, "openapi", "source.json");

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

export function canonicalStringify(value) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JSON contains a non-finite number.");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error("JSON contains an integer outside the safe range.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalStringify(value[key])}`,
      )
      .join(",")}}`;
  }

  throw new Error("JSON contains an unsupported value.");
}

export function canonicalJsonSha256(value) {
  const digest = createHash("sha256")
    .update(canonicalStringify(value), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

export function validateSnapshotDescriptor(snapshot, descriptor) {
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor)
  ) {
    throw new Error("OpenAPI source descriptor has an unexpected shape.");
  }

  const descriptorKeys = Object.keys(descriptor).sort();
  if (
    canonicalStringify(descriptorKeys) !==
    canonicalStringify(expectedDescriptorKeys)
  ) {
    throw new Error("OpenAPI source descriptor has an unexpected shape.");
  }

  if (descriptor.schemaVersion !== openApiDescriptorSchemaVersion) {
    throw new Error("OpenAPI source descriptor has an invalid schema version.");
  }

  if (!/^sha256:[0-9a-f]{64}$/.test(descriptor.openApiSha256)) {
    throw new Error("OpenAPI source descriptor has an invalid fingerprint.");
  }

  if (descriptor.swaggerPath !== "/swagger/v1/swagger.json") {
    throw new Error("OpenAPI source descriptor has an invalid Swagger path.");
  }

  if (
    snapshot?.info?.version !== "v1" ||
    snapshot?.paths?.["/api/v1/system/ping"]?.get?.operationId !==
      "GetSystemPing"
  ) {
    throw new Error("The tracked OpenAPI snapshot is not the expected v1 contract.");
  }

  if (descriptor.openApiSha256 !== canonicalJsonSha256(snapshot)) {
    throw new Error("OpenAPI source descriptor does not match the tracked snapshot.");
  }

  return snapshot;
}

export async function validateTrackedSnapshot() {
  const [snapshot, descriptor] = await Promise.all([
    readJson(snapshotPath),
    readJson(sourceDescriptorPath),
  ]);

  return validateSnapshotDescriptor(snapshot, descriptor);
}
