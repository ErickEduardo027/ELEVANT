import { describe, expect, it } from "vitest";
import { operationStatusLabel } from "@/lib/operation-status";

describe("operation status in the portal (2-N26)", () => {
  it("names every status in Spanish whatever the casing of the code, and keeps an unknown one", () => {
    expect(operationStatusLabel("InProgress")).toBe("En curso");
    expect(operationStatusLabel("in_progress")).toBe("En curso");
    expect(operationStatusLabel("PendingReview")).toBe("Pendiente de revisión");
    expect(operationStatusLabel("Returned")).toBe("Devuelta para corrección");
    expect(operationStatusLabel("Cancelled")).toBe("Cancelada");
    expect(operationStatusLabel("Diverted")).toBe("Diverted");
    expect(operationStatusLabel(null)).toBe("");
  });
});
