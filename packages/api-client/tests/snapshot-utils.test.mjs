import { describe, expect, it } from "vitest";
import {
  canonicalJsonSha256,
  canonicalStringify,
  openApiDescriptorSchemaVersion,
  readJson,
  snapshotPath,
  sourceDescriptorPath,
  validateSnapshotDescriptor,
  validateTrackedSnapshot,
} from "../scripts/snapshot-utils.mjs";

const swaggerPath = "/swagger/v1/swagger.json";

function contract(overrides = {}) {
  return {
    openapi: "3.0.1",
    info: { title: "ELEVANT API", version: "v1" },
    paths: {
      "/api/v1/system/ping": {
        get: { operationId: "GetSystemPing", responses: {} },
      },
    },
    ...overrides,
  };
}

function descriptor(snapshot) {
  return {
    schemaVersion: openApiDescriptorSchemaVersion,
    openApiSha256: canonicalJsonSha256(snapshot),
    swaggerPath,
  };
}

describe("canonical OpenAPI fingerprint", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const value = {
      z: [{ b: 2, a: 1 }, "last"],
      a: { y: true, x: null },
      2: "two",
      10: "ten",
    };

    expect(canonicalStringify(value)).toBe(
      '{"10":"ten","2":"two","a":{"x":null,"y":true},"z":[{"a":1,"b":2},"last"]}',
    );
  });

  it("is stable across property order and sensitive to array order", () => {
    const first = {
      paths: { b: [1, 2], a: { y: 2, x: 1 } },
      openapi: "3.0.1",
    };
    const reordered = {
      openapi: "3.0.1",
      paths: { a: { x: 1, y: 2 }, b: [1, 2] },
    };
    const changedArray = {
      openapi: "3.0.1",
      paths: { a: { x: 1, y: 2 }, b: [2, 1] },
    };

    expect(canonicalJsonSha256(first)).toBe(canonicalJsonSha256(reordered));
    expect(canonicalJsonSha256(first)).not.toBe(
      canonicalJsonSha256(changedArray),
    );
  });

  it("rejects values that JSON cannot represent deterministically", () => {
    expect(() => canonicalStringify({ value: Number.NaN })).toThrow(
      "non-finite number",
    );
    expect(() =>
      canonicalStringify({ value: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow("integer outside the safe range");
    expect(() => canonicalStringify({ value: undefined })).toThrow(
      "unsupported value",
    );
  });
});

describe("OpenAPI source descriptor", () => {
  it("accepts the exact schema and matching snapshot", () => {
    const snapshot = contract();
    expect(validateSnapshotDescriptor(snapshot, descriptor(snapshot))).toBe(
      snapshot,
    );
  });

  it.each([
    ["legacy key", (value) => ({ ...value, sourceCommit: "a".repeat(40) })],
    ["missing key", ({ swaggerPath: _swaggerPath, ...value }) => value],
    ["array root", () => []],
    ["null root", () => null],
  ])("rejects an unexpected shape: %s", (_name, mutate) => {
    const snapshot = contract();
    expect(() =>
      validateSnapshotDescriptor(snapshot, mutate(descriptor(snapshot))),
    ).toThrow("unexpected shape");
  });

  it("rejects invalid schema, fingerprint, and Swagger path values", () => {
    const snapshot = contract();
    const valid = descriptor(snapshot);

    expect(() =>
      validateSnapshotDescriptor(snapshot, { ...valid, schemaVersion: "1" }),
    ).toThrow("invalid schema version");
    expect(() =>
      validateSnapshotDescriptor(snapshot, {
        ...valid,
        openApiSha256: "sha256:no",
      }),
    ).toThrow("invalid fingerprint");
    expect(() =>
      validateSnapshotDescriptor(snapshot, {
        ...valid,
        swaggerPath: "/swagger.json",
      }),
    ).toThrow("invalid Swagger path");
  });

  it("detects snapshot drift without trusting the descriptor", () => {
    const snapshot = contract();
    const valid = descriptor(snapshot);
    const changed = contract({
      info: { title: "ELEVANT API changed", version: "v1" },
    });

    expect(() => validateSnapshotDescriptor(changed, valid)).toThrow(
      "does not match the tracked snapshot",
    );
  });

  it("keeps the tracked descriptor equal to the tracked snapshot", async () => {
    const [snapshot, source] = await Promise.all([
      readJson(snapshotPath),
      readJson(sourceDescriptorPath),
    ]);

    await expect(validateTrackedSnapshot()).resolves.toEqual(snapshot);
    expect(source).toEqual({
      schemaVersion: 1,
      openApiSha256:
        "sha256:23813da71115d2df0ed776e57fc92fef4c00409ae6c3f4d79c886322fa3072e3",
      swaggerPath,
    });
    expect(source.openApiSha256).toBe(canonicalJsonSha256(snapshot));
  });
});
