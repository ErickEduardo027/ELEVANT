"use client";

import { useState } from "react";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { invoiceTitle, noteTitle } from "@/lib/airline-invoices";
import type { AirlineTreasuryInvoice, AirlineTreasuryNote } from "@/lib/airline-treasury-service";
import { downloadFile } from "@/lib/download-file";
import { formatMoney } from "@/lib/portal-format";
import styles from "./AirlinePortalPage.module.css";
import { Button, type ButtonVariant } from "./PortalUi";

/**
 * How the portal names and downloads the airline's invoices and the credit and debit notes that modify them. «Facturas»,
 * «Estado de cuenta», «Documentos» and «Reportes» share it.
 */
export { invoiceStatus, invoiceTitle, noteTitle } from "@/lib/airline-invoices";

/** «USD 1,234.50» (es-DO, 2 decimals): the one money format of the portal. */
export function amount(currency: string, total: number) {
  return formatMoney(currency, total);
}

/** Saves a PDF Blob with a readable name (the shared `downloadFile`). */
export const saveBlob = downloadFile;

/**
 * A download with its own «Preparando…» and recoverable error, so a failed PDF never hides the list it belongs to.
 * `name` gives the button its full accessible name when the visible text alone does not say which document it is.
 */
export function DownloadButton({ text, name, busyText, failure, download, variant = "secondary" }: {
  text: string; name?: string; busyText: string; failure: string; download: () => Promise<void>; variant?: ButtonVariant;
}) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  return <>
    <Button variant={variant} disabled={state === "loading"} aria-label={name}
      onClick={() => {
        setState("loading");
        void download().then(() => setState("idle"), () => setState("error"));
      }}>{state === "loading" ? busyText : text}</Button>
    {state === "error" && <p role="alert" className={styles.fieldError}>{failure}</p>}
  </>;
}

/**
 * The invoice's PDF. In a list its name says which invoice («Descargar PDF de Factura E31…»); on the invoice's own page
 * `text` reads «Descargar factura (PDF)».
 */
export function InvoicePdfButton({ invoice, text, variant }: {
  invoice: Pick<AirlineTreasuryInvoice, "id" | "fiscalNumber" | "number">; text?: string; variant?: ButtonVariant;
}) {
  const { getInvoiceDocument } = useAirlineSession();
  return <DownloadButton text={text ?? "Descargar PDF"} name={text ? undefined : `Descargar PDF de ${invoiceTitle(invoice)}`}
    busyText="Preparando PDF…" failure="No se pudo descargar el PDF. Inténtelo de nuevo." variant={variant}
    download={() => getInvoiceDocument(invoice.id)
      .then(blob => saveBlob(blob, `factura-${invoice.fiscalNumber ?? invoice.number}.pdf`))} />;
}

/** 4-N17: the PDF of a credit or debit note of the airline's invoice: its e-NCF, its frozen ITBIS and the simulation label. */
export function AdjustmentNotePdfButton({ note, variant = "ghost" }: {
  note: Pick<AirlineTreasuryNote, "id" | "kind" | "number">; variant?: ButtonVariant;
}) {
  const { getAdjustmentNoteDocument } = useAirlineSession();
  return <DownloadButton text="Descargar PDF" name={`Descargar PDF de ${noteTitle(note)}`} busyText="Preparando PDF…"
    failure="No se pudo descargar el PDF de la nota. Inténtelo de nuevo." variant={variant}
    download={() => getAdjustmentNoteDocument(note.id).then(blob => saveBlob(blob, `nota-${note.number}.pdf`))} />;
}
