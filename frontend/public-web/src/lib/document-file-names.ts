/**
 * The names of the PDF files of ELEVANT's documents, the same the API sends (`DocumentFileNames`, PR E):
 * `factura-{e-NCF}.pdf`, `nota-credito-{n}.pdf` / `nota-debito-{n}.pdf` and `recibo-{factura}-{n}.pdf`. Any character that
 * is not a letter, a digit, `-`, `_` or `.` becomes `-`.
 */
const clean = (name: string) => name.trim().replace(/[^\p{L}\p{N}\-_.]/gu, "-");

export const invoiceFileName = (number: string) => `${clean(`factura-${number}`)}.pdf`;

/** A note's file: `kind` is «Credit» or «Debit». */
export const adjustmentNoteFileName = (kind: string, number: string) =>
  `${clean(`nota-${kind === "Debit" ? "debito" : "credito"}-${number}`)}.pdf`;

/** A receipt's file: the invoice it settles (its e-NCF when it has one) and the receipt's own reference. */
export const receiptFileName = (invoiceNumber: string, reference: string) =>
  `${clean(`recibo-${invoiceNumber}-${reference}`)}.pdf`;
