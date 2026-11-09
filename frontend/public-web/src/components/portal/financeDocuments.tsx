"use client";

import { useState } from "react";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import type { AirlineTreasuryInvoice, AirlineTreasuryNote } from "@/lib/airline-treasury-service";
import styles from "./AirlinePortalPage.module.css";

/**
 * How the portal names and downloads the airline's invoices and the credit and debit notes that modify them. «Facturas»,
 * «Estado de cuenta», «Documentos» and «Reportes» share it.
 */

export function amount(currency: string, total: number) {
  return `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(total)}`;
}

/**
 * Pagada when nothing is owed, Vencida past its due date, Pendiente otherwise (ADR-0035). 4-N24: an invoice that
 * nobody paid and that credit notes brought to zero is «Anulada», never «Pagada».
 */
export function invoiceStatus(invoice: Pick<AirlineTreasuryInvoice, "balance" | "daysOverdue" | "applied" | "legacyPaid" |
  "credited" | "legacyCredited" | "debited">) {
  if (invoice.balance <= 0) {
    const paid = invoice.applied + invoice.legacyPaid;
    const credited = invoice.credited + invoice.legacyCredited - invoice.debited;
    return paid <= 0 && credited > 0 ? "Anulada" : "Pagada";
  }
  return invoice.daysOverdue > 0 ? "Vencida" : "Pendiente";
}

export function invoiceTitle(invoice: Pick<AirlineTreasuryInvoice, "fiscalNumber" | "number">) {
  return invoice.fiscalNumber ? `Factura ${invoice.fiscalNumber}` : `Factura ${invoice.number}`;
}

/** 4-N17: a note on an E31 invoice carries its own simulated e-NCF: E34 credits the invoice, E33 debits it. */
export function noteTitle(note: Pick<AirlineTreasuryNote, "kind" | "number">) {
  const kind = note.kind === "Credit" ? "crédito" : "débito";
  return /^E3[34]\d{10}$/.test(note.number) ? `Nota de ${kind} electrónica ${note.number}` : `Nota de ${kind} ${note.number}`;
}

/** Saves a PDF Blob with a readable name. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** A download with its own «Preparando…» and recoverable error, so a failed PDF never hides the list it belongs to. */
function DownloadButton({ label, busyLabel, failure, download }: {
  label: string; busyLabel: string; failure: string; download: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  return <>
    <button type="button" className={styles.loadMore} disabled={state === "loading"} aria-label={label}
      onClick={() => {
        setState("loading");
        void download().then(() => setState("idle"), () => setState("error"));
      }}>{state === "loading" ? busyLabel : "Descargar PDF"}</button>
    {state === "error" && <p role="alert">{failure}</p>}
  </>;
}

export function InvoicePdfButton({ invoice }: { invoice: Pick<AirlineTreasuryInvoice, "id" | "fiscalNumber" | "number"> }) {
  const { getInvoiceDocument } = useAirlineSession();
  return <DownloadButton label={`Descargar PDF de ${invoiceTitle(invoice)}`} busyLabel="Preparando PDF…"
    failure="No se pudo descargar el PDF. Inténtalo de nuevo."
    download={() => getInvoiceDocument(invoice.id)
      .then(blob => saveBlob(blob, `factura-${invoice.fiscalNumber ?? invoice.number}.pdf`))} />;
}

/** 4-N17: the PDF of a credit or debit note of the airline's invoice: its e-NCF, its frozen ITBIS and the simulation label. */
export function AdjustmentNotePdfButton({ note }: { note: Pick<AirlineTreasuryNote, "id" | "kind" | "number"> }) {
  const { getAdjustmentNoteDocument } = useAirlineSession();
  return <DownloadButton label={`Descargar PDF de ${noteTitle(note)}`} busyLabel="Preparando PDF…"
    failure="No se pudo descargar el PDF de la nota. Inténtalo de nuevo."
    download={() => getAdjustmentNoteDocument(note.id).then(blob => saveBlob(blob, `nota-${note.number}.pdf`))} />;
}
