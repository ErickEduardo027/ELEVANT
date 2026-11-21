"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { useAirlineStanding } from "@/components/auth/useAirlineStanding";
import { filterInvoices, formatByCurrency, invoiceIssueDates, invoiceNumber, invoiceStatus, invoiceSummary, invoiceTitle,
  STATUS_TONE, sumByCurrency, type CurrencyAmount, type InvoiceFilters, type InvoiceStatusFilter } from "@/lib/airline-invoices";
import type { AirlineTreasuryInvoice, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import { businessToday } from "@/lib/business-day";
import { formatDate, formatMoney } from "@/lib/portal-format";
import styles from "./AirlinePortalPage.module.css";
import { InvoicePdfButton } from "./financeDocuments";
import { LiveSnapshotNotice } from "./LiveSnapshotNotice";
import { ActionGroup, Button, ButtonLink, DataTable, StatusBadge, type Column } from "./PortalUi";
import { useLiveSnapshot } from "./useLiveSnapshot";

export { amount, InvoicePdfButton, invoiceStatus, invoiceTitle, saveBlob } from "./financeDocuments";

// 4-N10: the cutoff is the business day of Santo Domingo, the one the server checks.
const today = () => businessToday();

export const INVOICES_PATH = "/portal/finanzas";
export const STATEMENT_PATH = "/portal/finanzas/estado-de-cuenta";
export const invoicePath = (id: string) => `${INVOICES_PATH}/facturas/${encodeURIComponent(id)}`;

/** «Facturas | Estado de cuenta»: two pages of the airline's financial account, each with its own URL. */
export function FinanceTabs({ current }: { current: "invoices" | "statement" }) {
  return <nav className={styles.tabs} aria-label="Vista de la cuenta financiera">
    <Link href={INVOICES_PATH} prefetch={false} aria-current={current === "invoices" ? "page" : undefined}>Facturas</Link>
    <Link href={STATEMENT_PATH} prefetch={false} aria-current={current === "statement" ? "page" : undefined}>Estado de cuenta</Link>
  </nav>;
}

/** 2-N32: invoices keep their stations after a contract is suspended or expires; the filters offer them all. */
export function useBillingStations() {
  const { session } = useAirlineSession();
  const { standing } = useAirlineStanding();
  return standing.status === "ready" ? standing.data.stations : session?.bootstrap.stations ?? [];
}

/** One amount per currency, each on its own line, for a table cell. */
export function Amounts({ items }: { items: readonly CurrencyAmount[] }) {
  if (items.length <= 1) return <>{formatByCurrency(items)}</>;
  return <span className={styles.cellStack}>{items.map(item =>
    <span key={item.currency}>{formatMoney(item.currency, item.value)}</span>)}</span>;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const STATUS_OPTIONS: { value: InvoiceStatusFilter; label: string }[] = [
  { value: "", label: "Todas" }, { value: "open", label: "Con saldo (pendientes y vencidas)" },
  { value: "Pendiente", label: "Pendientes" }, { value: "Vencida", label: "Vencidas" }, { value: "Pagada", label: "Pagadas" },
  { value: "Anulada", label: "Anuladas" },
];

/**
 * «Facturas»: the airline's invoices in one table, with their status, issue and due dates, total and balance (ADR-0035),
 * KPI with their context and filters. Each invoice opens on its own page; «Estado de cuenta» (4-N30) has its own too.
 */
export function AirlineFinancePage({ airlineName }: { airlineName: string }) {
  const { getTreasuryStatement, financeRevision } = useAirlineSession();
  const stations = useBillingStations();
  const [stationId, setStationId] = useState("");
  const [filters, setFilters] = useState<InvoiceFilters>({});
  const read = useCallback((signal: AbortSignal) => getTreasuryStatement(today(), stationId || undefined, signal),
    [getTreasuryStatement, stationId]);
  // 4-N25: the list stays on screen while a live change or the focus reads it again.
  const snapshot = useLiveSnapshot<AirlineTreasuryStatement>(`invoices|${stationId}`, financeRevision, read);
  const statement = snapshot.data;
  const invoices = useMemo(() => statement?.invoices ?? [], [statement]);
  const issued = useMemo(() => invoiceIssueDates(statement?.movements ?? []), [statement]);
  const shown = useMemo(() => filterInvoices(invoices, filters, issued), [filters, invoices, issued]);
  const summary = invoiceSummary(invoices);
  // 4-N30: credit notes beyond what was owed and receipts not applied yet (a charter's prepayment over its invoice).
  const credit = sumByCurrency((statement?.aging ?? []).map(item => ({ currency: item.currencyCode,
    value: item.creditBalance + item.unallocated }))).filter(item => item.value > 0);
  const billedOf = summary.count ? `de ${formatByCurrency(summary.billed)} facturado` : "Sin facturas emitidas.";
  const filtered = Boolean(filters.status || filters.from || filters.to || filters.search?.trim());
  const set = (patch: InvoiceFilters) => setFilters(current => ({ ...current, ...patch }));

  const columns: Column<AirlineTreasuryInvoice>[] = [
    { key: "number", header: "e-NCF", cell: item => <span className={styles.cellStack}>
      <Link href={invoicePath(item.id)} prefetch={false}>{invoiceNumber(item)}</Link>
      {item.fiscalNumber && <span className={styles.subtle}>Interno {item.number}</span>}</span> },
    { key: "station", header: "Estación", cell: item => item.stationCode },
    { key: "issued", header: "Emisión", cell: item => formatDate(issued.get(item.id)) },
    { key: "due", header: "Vencimiento", cell: item => <span className={styles.cellStack}>{formatDate(item.dueDate)}
      {item.daysOverdue > 0 && item.balance > 0 && <span className={styles.subtle}>{plural(item.daysOverdue, "día", "días")} de atraso</span>}</span> },
    { key: "status", header: "Estado", cell: item => { const status = invoiceStatus(item);
      return <StatusBadge tone={STATUS_TONE[status]}>{status}</StatusBadge>; } },
    { key: "total", header: "Total", numeric: true, cell: item => formatMoney(item.currencyCode, item.total),
      total: <Amounts items={sumByCurrency(shown.map(item => ({ currency: item.currencyCode, value: item.total })))} /> },
    { key: "balance", header: "Saldo", numeric: true, cell: item => formatMoney(item.currencyCode, item.balance),
      total: <Amounts items={sumByCurrency(shown.map(item => ({ currency: item.currencyCode, value: item.balance })))} /> },
    { key: "actions", header: <span className={styles.visuallyHidden}>Acciones</span>, label: "", cell: item =>
      <ActionGroup>
        <ButtonLink variant="ghost" href={invoicePath(item.id)} aria-label={`Ver detalle de ${invoiceTitle(item)}`}>Ver detalle</ButtonLink>
        <InvoicePdfButton invoice={item} variant="ghost" />
      </ActionGroup> },
  ];

  return <div className={styles.page}>
    <header className={styles.billingHeader}>
      <div>
        <span className={styles.kicker}>Cuenta financiera · {airlineName}</span>
        <h1>Facturas</h1>
        <p>Facturas emitidas por AVIAM por las operaciones completadas, con su vencimiento y saldo, y el estado de cuenta de su aerolínea.</p>
      </div>
    </header>
    <FinanceTabs current="invoices" />
    {!statement && !snapshot.failed && <p role="status">Cargando facturas autorizadas…</p>}
    {!statement && snapshot.failed && <div role="alert" className={styles.notice} data-tone="danger">
      <p>No se pudieron consultar las facturas.</p>
      <ActionGroup><Button onClick={snapshot.retry}>Reintentar</Button></ActionGroup></div>}
    <LiveSnapshotNotice snapshot={snapshot} />
    {statement && <>
      <div className={styles.kpis} aria-label="Resumen de facturas" role="group">
        <div><span>Facturas con saldo</span><strong>{summary.open} de {summary.count}</strong>
          <small>{summary.open === 0 ? "Todas sus facturas están saldadas." : "facturas pendientes de pago"}</small></div>
        <div><span>Saldo pendiente</span><strong>{formatByCurrency(summary.outstanding)}</strong>
          <small>{billedOf}</small></div>
        <div data-tone={summary.overdue > 0 ? "danger" : undefined}><span>Vencido</span>
          <strong>{formatByCurrency(summary.overdueBalance)}</strong>
          <small>{summary.overdue === 0 ? "Ninguna factura vencida." : `${plural(summary.overdue, "factura vencida", "facturas vencidas")} de ${summary.open} con saldo`}</small></div>
        <div><span>Cobrado</span><strong>{formatByCurrency(summary.collected)}</strong>
          <small>{billedOf}</small></div>
        <div><span>Saldo a favor</span><strong>{formatByCurrency(credit)}</strong>
          <small>Notas de crédito y cobros sin aplicar</small></div>
      </div>
      <form className={styles.filters} role="search" aria-label="Filtrar facturas" onSubmit={event => event.preventDefault()}>
        <label>Estado<select value={filters.status ?? ""} onChange={event => set({ status: event.target.value as InvoiceStatusFilter })}>
          {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Emitidas desde<input type="date" value={filters.from ?? ""} max={filters.to || undefined}
          onChange={event => set({ from: event.target.value })} /></label>
        <label>Emitidas hasta<input type="date" value={filters.to ?? ""} min={filters.from || undefined}
          onChange={event => set({ to: event.target.value })} /></label>
        <label>Estación<select value={stationId} onChange={event => setStationId(event.target.value)}>
          <option value="">Todas las estaciones</option>
          {stations.map(station => <option key={station.id} value={station.id}>{station.code}</option>)}</select></label>
        <label>Número de factura<input type="search" value={filters.search ?? ""} placeholder="e-NCF o número interno"
          onChange={event => set({ search: event.target.value })} /></label>
        {(filtered || stationId) && <ActionGroup><Button variant="ghost" onClick={() => { setFilters({}); setStationId(""); }}>
          Limpiar filtros</Button></ActionGroup>}
      </form>
      {invoices.length === 0 ? <p className={styles.empty}>No hay facturas emitidas para esta aerolínea.</p> : <>
        <p className={styles.subtle}>{filtered
          ? `${plural(shown.length, "factura coincide", "facturas coinciden")} con los filtros, de ${invoices.length}.`
          : `${plural(invoices.length, "factura emitida", "facturas emitidas")}.`}</p>
        <DataTable caption="Facturas" rows={shown} rowKey={item => item.id} columns={columns}
          totalLabel={`Total (${plural(shown.length, "factura", "facturas")})`}
          empty="Ninguna factura coincide con los filtros." />
      </>}
    </>}
  </div>;
}
