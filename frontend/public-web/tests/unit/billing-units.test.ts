import { describe, expect, it } from "vitest";
import { billingUnitLabel } from "@/lib/billing-units";

describe("billingUnitLabel (1-E)", () => {
  it("shows the unit codes of the contracts in Spanish", () => {
    expect(["operation", "hour", "ton", "day"].map(billingUnitLabel)).toEqual(["operación", "hora", "tonelada", "día"]);
  });

  it("keeps a legacy name or an unknown unit as it is", () => {
    expect(billingUnitLabel("operación")).toBe("operación");
    expect(billingUnitLabel(" turno ")).toBe("turno");
    expect(billingUnitLabel(null)).toBe("");
    expect(billingUnitLabel("constructor")).toBe("constructor");
  });
});
