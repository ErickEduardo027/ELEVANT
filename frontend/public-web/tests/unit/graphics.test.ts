import { describe, expect, it } from "vitest";

import {
  selectGraphicTier,
  type GraphicsSignals,
} from "@/lib/graphics";

const fullSignals: GraphicsSignals = {
  reducedMotion: false,
  saveData: false,
  effectiveType: "4g",
  webGLAvailable: true,
  deviceMemory: 8,
  viewportWidth: 1_440,
};

describe("selectGraphicTier", () => {
  it("selects FULL for a capable desktop", () => {
    expect(selectGraphicTier(fullSignals)).toBe("FULL");
  });

  it.each([
    ["reduced motion", { reducedMotion: true }],
    ["data saver", { saveData: true }],
    ["WebGL unavailable", { webGLAvailable: false }],
    ["slow-2g connection", { effectiveType: "slow-2g" }],
    ["2g connection", { effectiveType: "2g" }],
  ] satisfies ReadonlyArray<
    readonly [string, Partial<GraphicsSignals>]
  >)("selects STATIC for %s", (_reason, override) => {
    expect(selectGraphicTier({ ...fullSignals, ...override })).toBe("STATIC");
  });

  it("normalizes the connection label before selecting a tier", () => {
    expect(
      selectGraphicTier({ ...fullSignals, effectiveType: "  SLOW-2G " }),
    ).toBe("STATIC");
  });

  it.each([
    ["a 3g connection", { effectiveType: "3g" }],
    ["a phone viewport", { viewportWidth: 390 }],
    ["a tablet viewport", { viewportWidth: 768 }],
    ["four GB of memory", { deviceMemory: 4 }],
    ["an invalid viewport measurement", { viewportWidth: Number.NaN }],
  ] satisfies ReadonlyArray<
    readonly [string, Partial<GraphicsSignals>]
  >)("selects LITE for %s", (_reason, override) => {
    expect(selectGraphicTier({ ...fullSignals, ...override })).toBe("LITE");
  });

  it("uses the desktop tier at the 1024px boundary", () => {
    expect(
      selectGraphicTier({ ...fullSignals, viewportWidth: 1_024 }),
    ).toBe("FULL");
  });

  it("treats unavailable memory information as non-blocking", () => {
    expect(
      selectGraphicTier({ ...fullSignals, deviceMemory: undefined }),
    ).toBe("FULL");
    expect(selectGraphicTier({ ...fullSignals, deviceMemory: null })).toBe(
      "FULL",
    );
  });

  it("treats unknown connection labels as non-blocking", () => {
    expect(
      selectGraphicTier({ ...fullSignals, effectiveType: "5g" }),
    ).toBe("FULL");
    expect(
      selectGraphicTier({ ...fullSignals, effectiveType: undefined }),
    ).toBe("FULL");
  });

  it("gives STATIC constraints priority over LITE constraints", () => {
    expect(
      selectGraphicTier({
        ...fullSignals,
        reducedMotion: true,
        viewportWidth: 390,
        deviceMemory: 2,
      }),
    ).toBe("STATIC");
  });

  it("does not mutate the signal object", () => {
    const signals = Object.freeze({ ...fullSignals });

    expect(() => selectGraphicTier(signals)).not.toThrow();
    expect(signals).toEqual(fullSignals);
  });
});
