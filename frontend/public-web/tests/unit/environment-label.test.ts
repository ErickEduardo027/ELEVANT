import { afterEach, describe, expect, it, vi } from "vitest";
import { environmentLabel } from "@/lib/environment-label";

afterEach(() => { vi.unstubAllEnvs(); });

describe("portal environment label (1-N24)", () => {
  it("shows no environment unless the deployment names one", () => {
    vi.stubEnv("NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL", "");
    expect(environmentLabel()).toBeNull();
    expect(environmentLabel(undefined)).toBeNull();
    expect(environmentLabel("   ")).toBeNull();
  });

  it("reads the public variable and refuses anything that is not a short plain label", () => {
    vi.stubEnv("NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL", " Pruebas ");
    expect(environmentLabel()).toBe("Pruebas");
    expect(environmentLabel("Desarrollo QA-2")).toBe("Desarrollo QA-2");
    expect(environmentLabel("<b>Producción</b>")).toBeNull();
    expect(environmentLabel("x".repeat(33))).toBeNull();
  });
});
