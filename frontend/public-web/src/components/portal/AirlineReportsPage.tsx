"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AirlineOperationPageResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { filterInvoices, formatByCurrency, invoiceIssueDates, invoiceNumber, invoiceStatus, STATUS_TONE, sumByCurrency }
  from "@/lib/airline-invoices";
import type { AirlineTreasuryInvoice, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import { addDays, businessToday } from "@/lib/business-day";
import { downloadFile } from "@/lib/download-file";
import { operationStatusLabel } from "@/lib/operation-status";
import { formatDate, formatMoney } from "@/lib/portal-format";
import styles from "./AirlinePortalPage.module.css";
import { Amounts, invoicePath, useBillingStations } from "./AirlineFinancePage";
import { DownloadButton } from "./financeDocuments";
import { ActionGroup, Button, DataTable, StatusBadge } from "./PortalUi";

type ReportSnapshot = {
  revision: string;
  operations: AirlineOperationPageResponse;
  statement: AirlineTreasuryStatement;
};

type Operation = AirlineOperationPageResponse["operations"][number];

/** The period and station of the portal's reports; the exports receive the same ones the tables show. */
export interface ReportFilters { from: string; to: string; stationId: string }

/**
 * The exports of the report. They are passed only once the API serves the portal's PDF and Excel; without them the
 * page shows no export button at all (never a button that does nothing).
 */
export type ReportExports = Partial<Record<"pdf" | "excel", (filters: ReportFilters) => Promise<void>>>;

export function ReportExportActions({ exports, filters, label = "Exportar reporte" }: {
  exports?: ReportExports; filters: ReportFilters; label?: string;
}) {
  if (!exports?.pdf && !exports?.excel) return null;
  return <ActionGroup label={label}>
    {exports.excel && <DownloadButton text="Descargar Excel" busyText="Preparando Excel…"
      failure="No se pudo descargar el Excel. Inténtelo de nuevo." download={() => exports.excel!(filters)} />}
    {exports.pdf && <DownloadButton text="Descargar PDF" busyText="Preparando PDF…"
      failure="No se pudo descargar el PDF. Inténtelo de nuevo." download={() => exports.pdf!(filters)} />}
  </ActionGroup>;
}

/**
 * The server's PDF and Excel of a report of the portal with the filters on screen. Without a period it takes the last
 * year up to today (the longest the server accepts), as the tables show all the history loaded.
 */
export function useServerReportExports(key: "operations" | "invoices"): ReportExports {
  const { exportAirlineReport } = useAirlineSession();
  return useMemo(() => {
    const run = (format: "pdf" | "xlsx") => async (filters: ReportFilters) => {
      const to = filters.to || businessToday();
      const from = filters.from || addDays(to, -365);
      const blob = await exportAirlineReport(key, { from, to, ...(filters.stationId && { stationId: filters.stationId }) }, format);
      downloadFile(blob, `elevant-portal-${key}-${from.replaceAll("-", "")}-${to.replaceAll("-", "")}.${format}`);
    };
    return { pdf: run("pdf"), excel: run("xlsx") };
  }, [exportAirlineReport, key]);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * A bounded, tenant-scoped read model; it deliberately does not claim global KPIs. The filters apply to the data the
 * API already returned for the airline: the first page of its operations and every invoice issued until today.
 */
export function AirlineReportsPage({ airlineName, exports }: { airlineName: string; exports?: ReportExports }) {
  const { getOperations, getTreasuryStatement, operationRevision, financeRevision } = useAirlineSession();
  const stations = useBillingStations();
  const revision = `${operationRevision}:${financeRevision}`;
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [error, setError] = useState<{ revision: string; retry: number } | null>(null);
  const [filters, setFilters] = useState<ReportFilters>({ from: "", to: "", stationId: "" });

  useEffect(() => {
    const request = ++generation.current;
    void Promise.all([getOperations(1), getTreasuryStatement(businessToday())]).then(([operations, statement]) => {
      if (request !== generation.current) return;
      setSnapshot({ revision, operations, statement });
      setError(null);
    }).catch(() => {
      if (request !== generation.current) return;
      setSnapshot(null);
      setError({ revision, retry });
    });
    return () => { generation.current += 1; };
  }, [getOperations, getTreasuryStatement, revision, retry]);

  const visible = snapshot?.revision === revision && !error ? snapshot : null;
  const failed = error?.revision === revision && error.retry === retry;
  const issued = useMemo(() => invoiceIssueDates(visible?.statement.movements ?? []), [visible]);
  const operations = useMemo(() => (visible?.operations.operations ?? []).filter(item =>
    (!filters.stationId || item.stationId === filters.stationId) && (!filters.from || item.operationDate >= filters.from) &&
    (!filters.to || item.operationDate <= filters.to)), [filters, visible]);
  const invoices = useMemo(() => filterInvoices(visible?.statement.invoices ?? [], { from: filters.from, to: filters.to },
    issued).filter(item => !filters.stationId || item.stationId === filters.stationId), [filters, issued, visible]);
  const billed = sumByCurrency(invoices.map(item => ({ currency: item.currencyCode, value: item.total })));
  const owed = sumByCurrency(invoices.map(item => ({ currency: item.currencyCode, value: Math.max(0, item.balance) })));
  const set = (patch: Partial<ReportFilters>) => setFilters(current => ({ ...current, ...patch }));
  const operationExports = useServerReportExports("operations");
  const invoiceExports = useServerReportExports("invoices");

  return <div className={styles.page}>
    <header className={styles.billingHeader}>
      <div>
        <span className={styles.kicker}>Consulta autorizada · {airlineName}</span>
        <h1>Reportes operativos y financieros</h1>
        <p>Consulte las operaciones y facturas de su aerolínea. Las operaciones muestran la primera página de su historial y las
          facturas, todas las emitidas hasta hoy; no se calcula puntualidad ni cumplimiento sin datos completos. Las
          descargas en PDF y Excel traen el período completo que usted filtre (sin fechas, el último año), con sus
          totales y los servicios ejecutados.</p>
      </div>
      <ReportExportActions exports={exports} filters={filters} />
    </header>
    <form className={styles.filters} role="search" aria-label="Filtrar reportes" onSubmit={event => event.preventDefault()}>
      <label>Desde<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => set({ from: event.target.value })} /></label>
      <label>Hasta<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => set({ to: event.target.value })} /></label>
      <label>Estación<select value={filters.stationId} onChange={event => set({ stationId: event.target.value })}>
        <option value="">Todas las estaciones</option>
        {stations.map(station => <option key={station.id} value={station.id}>{station.code}</option>)}</select></label>
      {(filters.from || filters.to || filters.stationId) && <ActionGroup>
        <Button variant="ghost" onClick={() => setFilters({ from: "", to: "", stationId: "" })}>Limpiar filtros</Button></ActionGroup>}
    </form>
    {!visible && !failed && <p role="status">Cargando reportes autorizados…</p>}
    {failed && <div role="alert" className={styles.notice} data-tone="danger">
      <p>No se pudieron actualizar los reportes. Los datos anteriores se ocultaron.</p>
      <ActionGroup><Button onClick={() => { setError(null); setRetry(value => value + 1); }}>Reintentar reportes</Button></ActionGroup>
    </div>}
    {visible && <>
      <div className={styles.kpis} role="group" aria-label="Registros cargados del historial autorizado">
        <div><span>Operaciones</span><strong>{operations.length}</strong>
          <small>de {plural(visible.operations.operations.length, "operación cargada", "operaciones cargadas")}</small></div>
        <div><span>Facturas</span><strong>{invoices.length}</strong>
          <small>de {plural(visible.statement.invoices.length, "factura emitida", "facturas emitidas")}</small></div>
        <div><span>Facturado</span><strong>{formatByCurrency(billed)}</strong><small>en las facturas del filtro</small></div>
        <div><span>Saldo pendiente</span><strong>{formatByCurrency(owed)}</strong><small>de lo facturado en el filtro</small></div>
      </div>
      <section className={styles.section} aria-label="Reporte de operaciones">
        <header><h2>Operaciones</h2><Link href="/portal/vuelos">Ver historial completo</Link>
          <ReportExportActions exports={operationExports} filters={filters} label="Exportar operaciones y servicios" /></header>
        <DataTable<Operation> caption="Operaciones" rows={operations} rowKey={item => item.id!}
          empty={visible.operations.operations.length ? "Ninguna operación coincide con los filtros."
            : "No hay operaciones registradas para esta aerolínea."}
          totalLabel={`Total: ${plural(operations.length, "operación", "operaciones")}`} columns={[
            { key: "code", header: "Operación", cell: item =>
              <Link href={`/portal/vuelos/${encodeURIComponent(item.id!)}`}>{item.code}</Link> },
            { key: "station", header: "Estación", cell: item => item.stationCode },
            { key: "date", header: "Fecha", cell: item => formatDate(item.operationDate) },
            { key: "status", header: "Estado", cell: item => operationStatusLabel(item.status) },
          ]} />
        {visible.operations.hasMore && <p className={styles.scopeLine}>Hay más operaciones en el historial de vuelos.</p>}
      </section>
      <section className={styles.section} aria-label="Reporte de facturas">
        <header><h2>Facturas</h2><Link href="/portal/finanzas">Ver facturas</Link>
          <ReportExportActions exports={invoiceExports} filters={filters} label="Exportar facturas y pagos" /></header>
        <DataTable<AirlineTreasuryInvoice> caption="Facturas" rows={invoices} rowKey={item => item.id}
          empty={visible.statement.invoices.length ? "Ninguna factura coincide con los filtros."
            : "No hay facturas emitidas para esta aerolínea."}
          totalLabel={`Total: ${plural(invoices.length, "factura", "facturas")}`} columns={[
            { key: "number", header: "Factura", cell: item => <Link href={invoicePath(item.id)}>{invoiceNumber(item)}</Link> },
            { key: "station", header: "Estación", cell: item => item.stationCode },
            { key: "issued", header: "Emisión", cell: item => formatDate(issued.get(item.id)) },
            { key: "status", header: "Estado", cell: item => { const status = invoiceStatus(item);
              return <StatusBadge tone={STATUS_TONE[status]}>{status}</StatusBadge>; } },
            { key: "total", header: "Total", numeric: true, cell: item => formatMoney(item.currencyCode, item.total),
              total: <Amounts items={billed} /> },
            { key: "balance", header: "Saldo", numeric: true, cell: item => formatMoney(item.currencyCode, item.balance),
              total: <Amounts items={sumByCurrency(invoices.map(item => ({ currency: item.currencyCode, value: item.balance })))} /> },
          ]} />
      </section>
    </>}
  </div>;
}
