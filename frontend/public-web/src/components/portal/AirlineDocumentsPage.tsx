"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ElevantApiError, type AirlinePreinvoicePageResponse,
  type NonFiscalInvoiceResponse, type NonFiscalPaymentResponse } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import styles from "./AirlinePortalPage.module.css";

function savePdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AirlineDocumentsPage() {
  const { getPreinvoices, getPreinvoiceInvoice, getInvoicePayment,
    getInvoiceDocument, getPaymentReceipt, financeRevision } = useAirlineSession();
  const [pages, setPages] = useState<AirlinePreinvoicePageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selection, setSelection] = useState<{ preinvoiceId: string;
    status: "loading" | "ready" | "error" | "missing";
    invoice: NonFiscalInvoiceResponse | null;
    payment: NonFiscalPaymentResponse | null } | null>(null);
  const [download, setDownload] = useState<"idle" | "invoice" | "receipt" | "error">("idle");
  const generation = useRef(0);
  const selectionGeneration = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    selectionGeneration.current += 1;
    queueMicrotask(() => { if (request === generation.current) {
      setPages([]); setSelection(null); setDownload("idle"); setLoading(true);
    } });
    void getPreinvoices(1).then(page => {
      if (request === generation.current) { setPages([page]); setError(false); }
    }).catch(() => { if (request === generation.current) setError(true); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current += 1; selectionGeneration.current += 1; };
  }, [getPreinvoices, financeRevision, retryKey]);

  const loadMore = useCallback(async () => {
    if (loading || !pages.at(-1)?.hasMore) return;
    const request = generation.current;
    setLoading(true);
    try {
      const page = await getPreinvoices(pages.length + 1);
      if (request === generation.current) { setPages(current => [...current, page]); setError(false); }
    } catch { if (request === generation.current) setError(true); }
    finally { if (request === generation.current) setLoading(false); }
  }, [getPreinvoices, loading, pages]);

  const open = useCallback(async (preinvoiceId: string) => {
    const request = ++selectionGeneration.current;
    setSelection({ preinvoiceId, status: "loading", invoice: null, payment: null });
    setDownload("idle");
    try {
      const invoice = await getPreinvoiceInvoice(preinvoiceId);
      const payment = await getInvoicePayment(invoice.id);
      if (request === selectionGeneration.current)
        setSelection({ preinvoiceId, status: "ready", invoice, payment: payment.payment ?? null });
    } catch (cause) {
      if (request === selectionGeneration.current)
        setSelection({ preinvoiceId, status: cause instanceof ElevantApiError && cause.status === 404
          ? "missing" : "error", invoice: null, payment: null });
    }
  }, [getPreinvoiceInvoice, getInvoicePayment]);

  const downloadPdf = useCallback(async (kind: "invoice" | "receipt") => {
    if (!selection || selection.status !== "ready" || !selection.invoice ||
        (kind === "receipt" && !selection.payment) ||
        download === "invoice" || download === "receipt") return;
    const request = selectionGeneration.current;
    setDownload(kind);
    try {
      const blob = kind === "invoice"
        ? await getInvoiceDocument(selection.preinvoiceId)
        : await getPaymentReceipt(selection.invoice.id);
      if (request !== selectionGeneration.current) return;
      savePdf(blob, kind === "invoice" ? `factura-${selection.invoice.number}.pdf`
        : `recibo-${selection.payment!.id}.pdf`);
      setDownload("idle");
    } catch {
      if (request === selectionGeneration.current) setDownload("error");
    }
  }, [selection, download, getInvoiceDocument, getPaymentReceipt]);

  const invoiced = pages.flatMap(page => page.preinvoices)
    .filter(item => item.status === "Invoiced");
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Repositorio autorizado</span>
      <h1>Documentos</h1>
      <p>Facturas no fiscales y recibos de pagos registrados para tu aerolínea.</p>
    </header>
    {loading && pages.length === 0 && <p role="status">Cargando documentos autorizados…</p>}
    {error && <div role="alert">No se pudo actualizar la consulta de documentos.
      <button className={styles.loadMore} type="button" onClick={() => {
        setError(false); setRetryKey(current => current + 1);
      }}>Reintentar</button></div>}
    {!loading && pages.length > 0 && invoiced.length === 0 &&
      <p className={styles.empty}>No hay facturas emitidas en las páginas cargadas.</p>}
    {invoiced.map(item => <section className={styles.panel} key={item.id}
      aria-label={`Documentos de prefactura ${item.id}`}>
      <span className={styles.kicker}>{item.stationCode} · {item.from} — {item.to}</span>
      <h2>Prefactura facturada</h2>
      <p className={styles.note}>Total {item.currencyCode} {item.total.toFixed(2)}</p>
      <button className={styles.loadMore} type="button" onClick={() => void open(item.id)}>
        Ver documentos
      </button>
      {selection?.preinvoiceId === item.id && selection.status === "loading" &&
        <p role="status">Verificando documentos…</p>}
      {selection?.preinvoiceId === item.id && selection.status === "missing" &&
        <p role="alert">La factura ya no está disponible para esta cuenta.</p>}
      {selection?.preinvoiceId === item.id && selection.status === "error" &&
        <p role="alert">No se pudieron consultar los documentos. Inténtalo de nuevo.</p>}
      {selection?.preinvoiceId === item.id && selection.status === "ready" && selection.invoice &&
        <div className={styles.disputeRecord}>
          <strong>Factura no fiscal {selection.invoice.number}</strong>
          <button className={styles.loadMore} type="button"
            disabled={download === "invoice" || download === "receipt"}
            onClick={() => void downloadPdf("invoice")}>Descargar factura PDF</button>
          {selection.payment ? <>
            <strong>Pago registrado {selection.payment.reference}</strong>
            <button className={styles.loadMore} type="button"
              disabled={download === "invoice" || download === "receipt"}
              onClick={() => void downloadPdf("receipt")}>Descargar recibo PDF</button>
          </> : <p className={styles.note}>Aún no hay pago registrado para esta factura.</p>}
          {download === "error" && <p role="alert">No se pudo descargar el PDF. Inténtalo de nuevo.</p>}
        </div>}
    </section>)}
    {pages.at(-1)?.hasMore && <button className={styles.loadMore} type="button"
      disabled={loading} onClick={() => void loadMore()}>Cargar más</button>}
  </div>;
}
