import { describe, expect, it } from "vitest";

import { createPortalDocumentPdf } from "@/lib/portal-documents";
import { createPortalFixtures } from "@/lib/portal";

describe("documentos mock del portal", () => {
  it("genera un PDF válido y no vacío para una descarga autorizada", async () => {
    const fixtures = createPortalFixtures("2026-08-09T20:00:00.000Z");
    const document = fixtures.documents.find(
      (item) => item.id === "doc_demo_report",
    );

    expect(document).toBeDefined();
    const bytes = await createPortalDocumentPdf(document!, {
      airlineName: "ELEVANT Demo Airlines",
      station: "PUJ",
      generatedAt: new Date("2026-08-09T20:05:00.000Z"),
    });

    expect(bytes.byteLength).toBeGreaterThan(1_000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
