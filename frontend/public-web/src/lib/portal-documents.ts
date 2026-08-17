import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import type { PortalDocument } from "@/lib/portal";

type DocumentContext = {
  airlineName: string;
  station: string;
  generatedAt?: Date;
};

function safeFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function createPortalDocumentPdf(
  document: PortalDocument,
  context: DocumentContext,
): Promise<Uint8Array> {
  const generatedAt = context.generatedAt ?? new Date();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  page.drawRectangle({
    x: 0,
    y: height - 116,
    width,
    height: 116,
    color: rgb(0.016, 0.078, 0.18),
  });
  page.drawRectangle({
    x: 42,
    y: height - 95,
    width: 8,
    height: 48,
    color: rgb(1, 0.392, 0.122),
  });
  page.drawText("ELEVANT", {
    x: 66,
    y: height - 72,
    size: 22,
    font: bold,
    color: rgb(0.96, 0.98, 1),
  });
  page.drawText("Documento autorizado para aerolínea", {
    x: 66,
    y: height - 94,
    size: 10,
    font: regular,
    color: rgb(0.55, 0.82, 0.95),
  });

  const rows = [
    ["Documento", document.name],
    ["Tipo", document.type.replaceAll("_", " ")],
    ["Aerolínea", context.airlineName],
    ["Estación", context.station],
    ["Operación", document.operationId ?? "No asociada"],
    ["Fecha de publicación", new Date(document.createdAt).toLocaleString("es-DO")],
    ["Referencia", document.id],
  ];

  page.drawText(document.name, {
    x: 42,
    y: height - 166,
    size: 18,
    font: bold,
    color: rgb(0.028, 0.071, 0.141),
    maxWidth: width - 84,
  });

  let y = height - 220;
  for (const [label, value] of rows) {
    page.drawText(label.toUpperCase(), {
      x: 42,
      y,
      size: 8,
      font: bold,
      color: rgb(0.28, 0.36, 0.47),
    });
    page.drawText(value, {
      x: 190,
      y,
      size: 10,
      font: regular,
      color: rgb(0.028, 0.071, 0.141),
      maxWidth: width - 232,
    });
    page.drawLine({
      start: { x: 42, y: y - 12 },
      end: { x: width - 42, y: y - 12 },
      thickness: 0.6,
      color: rgb(0.82, 0.86, 0.91),
    });
    y -= 44;
  }

  page.drawRectangle({
    x: 42,
    y: 118,
    width: width - 84,
    height: 96,
    color: rgb(0.94, 0.97, 0.99),
    borderColor: rgb(0.63, 0.76, 0.88),
    borderWidth: 1,
  });
  page.drawText("DEMO LOCAL", {
    x: 58,
    y: 184,
    size: 9,
    font: bold,
    color: rgb(0.09, 0.34, 0.85),
  });
  page.drawText(
    "Archivo sintético generado para demostrar el flujo documental de ELEVANT. No constituye un documento fiscal u operacional real.",
    {
      x: 58,
      y: 153,
      size: 9,
      lineHeight: 14,
      font: regular,
      color: rgb(0.18, 0.27, 0.38),
      maxWidth: width - 116,
    },
  );
  page.drawText(`Generado ${generatedAt.toLocaleString("es-DO")}`, {
    x: 42,
    y: 62,
    size: 8,
    font: regular,
    color: rgb(0.38, 0.45, 0.55),
  });

  return pdf.save();
}

export async function downloadPortalDocument(
  document: PortalDocument,
  context: DocumentContext,
): Promise<void> {
  const bytes = await createPortalDocumentPdf(document, context);
  const buffer = Uint8Array.from(bytes).buffer;
  const baseName = safeFilename(document.name.replace(/\.[^.]+$/, "")) || document.id;
  downloadBlob(new Blob([buffer], { type: "application/pdf" }), `${baseName}.pdf`);
}

export function downloadPortalCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
): void {
  const escape = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  downloadBlob(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    `${safeFilename(filename) || "reporte-elevant"}.csv`,
  );
}
