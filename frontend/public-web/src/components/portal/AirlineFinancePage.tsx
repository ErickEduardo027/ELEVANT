"use client";

import { useEffect, useState } from "react";
import { ElevantApiError } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import type { AirlineTreasuryInvoice, AirlineTreasuryInvoiceDetail, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import styles from "./AirlinePortalPage.module.css";
import { CardPaymentPanel } from "./CardPaymentPanel";

const today = () => new Date().toISOString().slice(0, 10);

export function amount(currency: string, total: number) {
  return `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(total)}`;
}

const KIND: Record<string, string> = {
  Service: "Servicio", Charge: "Cargo", Adjustment: "Ajuste", Package: "Paquete", Excess: "Exceso", Minimum: "Mínimo",
};
const MOVEMENT: Record<string, string> = {
  Application: "Pago aplicado", ApplicationReversal: "Reverso de pago", LegacyPayment: "Pago histórico",
  LegacyCredit: "Crédito histórico", Credit: "Nota de crédito", Debit: "Nota de débito",
};

/** Pagada when nothing is owed, Vencida past its due date, Pendiente otherwise (ADR-0035). */
export function invoiceStatus(invoice: Pick<AirlineTreasuryInvoice, "balance" | "daysOverdue">) {
  if (invoice.balance <= 0) return "Pagada";
  return invoice.daysOverdue > 0 ? "Vencida" : "Pendiente";
}

export function invoiceTitle(invoice: Pick<AirlineTreasuryInvoice, "fiscalNumber" | "number">) {
  return invoice.fiscalNumber ? `Factura ${invoice.fiscalNumber}` : `Factura ${invoice.number}`;
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

export function InvoicePdfButton({ invoice }: { invoice: Pick<AirlineTreasuryInvoice, "id" | "fiscalNumber" | "number"> }) {
  const { getInvoiceDocument } = useAirlineSession();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  return <>
    <button type="button" className={styles.loadMore} disabled={state === "loading"}
      aria-label={`Descargar PDF de ${invoiceTitle(invoice)}`}
      onClick={() => {
        setState("loading");
        void getInvoiceDocument(invoice.id)
          .then(blob => { saveBlob(blob, `factura-${invoice.fiscalNumber ?? invoice.number}.pdf`); setState("idle"); })
          .catch(() => setState("error"));
      }}>{state === "loading" ? "Preparando PDF…" : "Descargar PDF"}</button>
    {state === "error" && <p role="alert">No se pudo descargar el PDF. Inténtalo de nuevo.</p>}
  </>;
}

function InvoiceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { getTreasuryInvoice, financeRevision } = useAirlineSession();
  const [state, setState] = useState<{ key: string; data: AirlineTreasuryInvoiceDetail | null; error: string }>(
    { key: "", data: null, error: "" });
  const [retry, setRetry] = useState(0);
  const key = `${id}|${financeRevision}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void getTreasuryInvoice(id, controller.signal)
      .then(data => { if (active) setState({ key, data, error: "" }); })
      .catch(error => {
        if (active) setState({ key, data: null, error: error instanceof ElevantApiError && error.status === 404
          ? "La factura no está disponible para esta cuenta." : "No se pudo consultar la factura. Inténtalo de nuevo." });
      });
    return () => { active = false; controller.abort(); };
  }, [getTreasuryInvoice, id, key]);
  const live = state.key === key ? state : null;
  // While a payment or a live change reloads it, the previous detail stays on screen.
  const detail = live?.data ?? (state.data?.invoice.id === id ? state.data : null);
  return <section className={styles.panel} aria-label="Detalle de factura">
    <div className={styles.requestCardHeading}>
      <h2>{detail ? invoiceTitle(detail.invoice) : "Factura"}</h2>
      <button type="button" className={styles.loadMore} onClick={onBack}>Volver a facturas</button>
    </div>
    {!live && !detail && <p role="status">Cargando factura…</p>}
    {live?.error && <div role="alert"><p>{live.error}</p>
      <button type="button" className={styles.loadMore} onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
    {detail && <>
      <p className={styles.note}>{detail.invoice.stationCode} · Interno {detail.invoice.number}
        {detail.invoice.dueDate ? ` · Vence el ${detail.invoice.dueDate}` : ""} · {invoiceStatus(detail.invoice)}</p>
      <div className={styles.metrics}>
        <div><span>Total con ITBIS</span><strong>{amount(detail.invoice.currencyCode, detail.invoice.total)}</strong></div>
        <div><span>Pagado</span><strong>{amount(detail.invoice.currencyCode, detail.invoice.applied + detail.invoice.legacyPaid)}</strong></div>
        <div><span>Saldo</span><strong>{amount(detail.invoice.currencyCode, detail.invoice.balance)}</strong></div>
      </div>
      <InvoicePdfButton invoice={detail.invoice} />
      <CardPaymentPanel invoiceId={detail.invoice.id} balance={detail.invoice.balance} currencyCode={detail.invoice.currencyCode}
        onChanged={() => setRetry(value => value + 1)} />
      {detail.invoice.fiscalNumber && <p className={styles.note}>Factura de crédito fiscal electrónica simulada. Simulación — sin validez fiscal.</p>}
      <section className={styles.preinvoiceLines} aria-label="Líneas de factura"><h3>Líneas</h3>
        {detail.lines.map(line => <p key={line.id} className={line.parentLineNumber ? styles.nestedLine : undefined}>
          {KIND[line.kind] ?? line.kind} · {line.operationCode} · {line.serviceName} · {amount(detail.invoice.currencyCode, line.amount)}
          {line.reason ? ` · ${line.reason}` : ""}
        </p>)}
      </section>
      <section className={styles.preinvoiceLines} aria-label="Pagos de la factura"><h3>Pagos</h3>
        {detail.movements.filter(item => item.kind !== "Invoice").length === 0 && <p>Sin pagos registrados.</p>}
        {detail.movements.filter(item => item.kind !== "Invoice").map(item => <p key={item.id}>
          {MOVEMENT[item.kind] ?? item.kind} · {item.effectiveOn} · {item.reference} · {amount(item.currencyCode, item.amount)}
        </p>)}
      </section>
    </>}
  </section>;
}

/** «Facturas»: the airline's invoices with status, due date, balance and PDF (ADR-0035). */
export function AirlineFinancePage({ airlineName }: { airlineName: string }) {
  const { getTreasuryStatement, financeRevision } = useAirlineSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; data: AirlineTreasuryStatement | null; error: boolean }>(
    { key: "", data: null, error: false });
  const key = `${financeRevision}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void getTreasuryStatement(today(), undefined, controller.signal)
      .then(data => { if (active) setState({ key, data, error: false }); })
      .catch(() => { if (active) setState({ key, data: null, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [getTreasuryStatement, key]);
  const live = state.key === key ? state : null;
  const invoices = live?.data?.invoices ?? [];
  const owed = invoices.filter(item => item.balance > 0);
  const byCurrency = (items: AirlineTreasuryInvoice[]) => [...new Set(items.map(item => item.currencyCode))]
    .map(currency => amount(currency, items.filter(item => item.currencyCode === currency).reduce((sum, item) => sum + item.balance, 0)))
    .join(" · ") || "—";

  if (selected) return <div className={styles.page}><InvoiceDetail id={selected} onBack={() => setSelected(null)} /></div>;
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Cuenta financiera · {airlineName}</span>
      <h1>Facturas</h1>
      <p>Facturas emitidas por AVIAM por las operaciones completadas, con su vencimiento y saldo.</p>
    </header>
    {!live && <p role="status">Cargando facturas autorizadas…</p>}
    {live?.error && <div role="alert"><p>No se pudieron consultar las facturas.</p>
      <button type="button" className={styles.loadMore} onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
    {live?.data && <>
      <div className={styles.metrics} aria-label="Resumen de facturas">
        <div><span>Facturas</span><strong>{invoices.length}</strong></div>
        <div><span>Pendientes</span><strong>{owed.filter(item => item.daysOverdue === 0).length}</strong></div>
        <div><span>Vencidas</span><strong>{owed.filter(item => item.daysOverdue > 0).length}</strong></div>
        <div><span>Saldo pendiente</span><strong>{byCurrency(owed)}</strong></div>
      </div>
      {invoices.length === 0 && <p className={styles.empty}>No hay facturas emitidas para esta aerolínea.</p>}
      {invoices.map(item => <section key={item.id} className={styles.panel} aria-label={invoiceTitle(item)}>
        <span className={styles.kicker}>{item.stationCode} · {invoiceStatus(item)}</span>
        <div className={styles.requestCardHeading}>
          <h2>{invoiceTitle(item)}</h2>
          <strong>Saldo {amount(item.currencyCode, item.balance)}</strong>
        </div>
        <p className={styles.note}>Total {amount(item.currencyCode, item.total)}{item.dueDate ? ` · Vence el ${item.dueDate}` : ""}
          {item.daysOverdue > 0 ? ` · ${item.daysOverdue} días de atraso` : ""}</p>
        <button type="button" className={styles.loadMore} onClick={() => setSelected(item.id)}>Ver detalle</button>
        <InvoicePdfButton invoice={item} />
      </section>)}
    </>}
  </div>;
}
