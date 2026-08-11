"use client";

import { useMemo, useState, type CSSProperties } from "react";

import { downloadPortalCsv } from "@/lib/portal-documents";

import { ChartIcon, FileIcon } from "./PortalIcons";
import {
  formatMoney,
  Panel,
  PortalPageHeader,
  portalModuleStyles as styles,
  statusLabel,
} from "./PortalModuleUI";
import { usePortalWorkspace } from "./PortalWorkspace";

type Period = "7" | "30" | "90" | "ALL";

function inPeriod(value: string, period: Period): boolean {
  if (period === "ALL") return true;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const days = Number(period);
  return timestamp >= Date.now() - days * 24 * 60 * 60 * 1_000;
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

function chartStyle(value: number): CSSProperties {
  return { "--bar-width": `${Math.max(0, Math.min(100, value))}%` } as CSSProperties;
}

const FLIGHT_STATUS_ORDER = ["COMPLETED", "IN_PROGRESS", "SCHEDULED", "CANCELLED"];

export function PortalReports() {
  const { data } = usePortalWorkspace();
  const [period, setPeriod] = useState<Period>("30");

  const report = useMemo(() => {
    const flights = data.flights.filter((flight) => inPeriod(flight.operationDate, period));
    const flightIds = new Set(flights.map((flight) => flight.id));
    const operations = data.operations.filter((operation) => flightIds.has(operation.flightId));
    const invoices = data.invoices.filter((invoice) => inPeriod(invoice.issuedAt, period));
    const reconciliations = data.reconciliations.filter((item) =>
      inPeriod(item.periodEnd, period),
    );
    const completedFlights = flights.filter(
      (flight) => flight.status === "COMPLETED" && flight.actualAt,
    );
    const onTimeFlights = completedFlights.filter(
      (flight) =>
        Date.parse(flight.actualAt as string) - Date.parse(flight.scheduledAt) <=
        15 * 60_000,
    );
    const services = operations.flatMap((operation) => operation.services);
    const contracted = services.reduce(
      (total, service) => total + service.contractedQuantity,
      0,
    );
    const executed = services.reduce(
      (total, service) => total + Math.min(service.executedQuantity, service.contractedQuantity),
      0,
    );
    const invoiceTotal = invoices.reduce((total, invoice) => total + invoice.total, 0);
    const varianceTotal = reconciliations.reduce(
      (total, reconciliation) => total + reconciliation.varianceAmount,
      0,
    );
    const statusRows = FLIGHT_STATUS_ORDER.map((status) => ({
      status,
      count: flights.filter((flight) => flight.status === status).length,
    })).filter((item) => item.count > 0);
    const serviceRows = [...new Set(services.map((service) => service.code))].map((code) => {
      const matching = services.filter((service) => service.code === code);
      const contractedQuantity = matching.reduce(
        (total, service) => total + service.contractedQuantity,
        0,
      );
      const executedQuantity = matching.reduce(
        (total, service) => total + service.executedQuantity,
        0,
      );
      return {
        code,
        name: matching[0]?.name ?? code,
        contractedQuantity,
        executedQuantity,
        compliance: percent(
          Math.min(executedQuantity, contractedQuantity),
          contractedQuantity,
        ),
      };
    });

    return {
      flights,
      operations,
      invoices,
      reconciliations,
      completedPercent: percent(completedFlights.length, flights.length),
      onTimePercent: percent(onTimeFlights.length, completedFlights.length),
      servicePercent: percent(executed, contracted),
      incidents: operations.reduce((total, operation) => total + operation.incidentCount, 0),
      invoiceTotal,
      varianceTotal,
      statusRows,
      serviceRows,
    };
  }, [data.flights, data.invoices, data.operations, data.reconciliations, period]);

  const exportOperational = () => {
    downloadPortalCsv(
      `reporte-operativo-elevant-${period === "ALL" ? "historico" : `${period}-dias`}`,
      [
        "Fecha",
        "Vuelo",
        "Dirección",
        "Origen",
        "Destino",
        "Estación",
        "Estado vuelo",
        "Matrícula",
        "Operación",
        "Estado operación",
        "Servicios contratados",
        "Servicios ejecutados",
        "Incidentes",
      ],
      report.flights.map((flight) => {
        const operation = report.operations.find((item) => item.flightId === flight.id);
        return [
          flight.operationDate,
          flight.flightNumber,
          flight.direction,
          flight.origin,
          flight.destination,
          flight.station,
          flight.status,
          flight.aircraftRegistration,
          operation?.id ?? null,
          operation?.status ?? null,
          operation?.services.reduce(
            (total, service) => total + service.contractedQuantity,
            0,
          ) ?? 0,
          operation?.services.reduce(
            (total, service) => total + service.executedQuantity,
            0,
          ) ?? 0,
          operation?.incidentCount ?? 0,
        ];
      }),
    );
  };

  const exportFinancial = () => {
    downloadPortalCsv(
      `reporte-financiero-elevant-${period === "ALL" ? "historico" : `${period}-dias`}`,
      [
        "Documento",
        "Tipo",
        "Periodo desde",
        "Periodo hasta",
        "Emisión",
        "Estado",
        "Moneda",
        "Subtotal",
        "Impuesto",
        "Total",
      ],
      report.invoices.map((invoice) => [
        invoice.invoiceNumber,
        invoice.kind,
        invoice.periodStart,
        invoice.periodEnd,
        invoice.issuedAt,
        invoice.status,
        invoice.currency,
        invoice.subtotal,
        invoice.tax,
        invoice.total,
      ]),
    );
  };

  return (
    <div className={styles.page}>
      <PortalPageHeader
        eyebrow="Inteligencia consultiva"
        title="Reportes operativos y financieros"
        description="Analiza el desempeño de la operación y descarga datasets listos para conciliación, control interno o análisis externo."
        actions={
          <div className={styles.actionsRow}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={exportOperational}
              disabled={report.flights.length === 0}
            >
              <FileIcon />
              CSV operativo
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={exportFinancial}
              disabled={report.invoices.length === 0}
            >
              <FileIcon />
              CSV financiero
            </button>
          </div>
        }
      />

      <Panel className={styles.reportPeriodPanel}>
        <div className={styles.reportPeriodControl}>
          <div>
            <p className={styles.eyebrow}>Periodo de análisis</p>
            <p className={styles.reportPeriodHint}>
              Los indicadores y exportaciones respetan el mismo intervalo.
            </p>
          </div>
          <div className={styles.selectControl}>
            <label className={styles.visuallyHidden} htmlFor="report-period">
              Seleccionar periodo
            </label>
            <select
              id="report-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value as Period)}
            >
              <option value="7">Últimos 7 días</option>
              <option value="30">Últimos 30 días</option>
              <option value="90">Últimos 90 días</option>
              <option value="ALL">Histórico disponible</option>
            </select>
          </div>
        </div>
      </Panel>

      <section className={styles.metricGrid} aria-label="Indicadores del periodo">
        <article className={styles.metricCard}>
          <span>Vuelos completados</span>
          <strong>{report.completedPercent}%</strong>
          <small>{report.flights.length} vuelos dentro del periodo</small>
        </article>
        <article className={styles.metricCard}>
          <span>Puntualidad</span>
          <strong>{report.onTimePercent}%</strong>
          <small>Llegada o salida dentro de 15 minutos</small>
        </article>
        <article className={styles.metricCard}>
          <span>Cumplimiento de servicio</span>
          <strong>{report.servicePercent}%</strong>
          <small>Unidades ejecutadas frente a contratadas</small>
        </article>
        <article className={styles.metricCard}>
          <span>Volumen facturado</span>
          <strong>{formatMoney(report.invoiceTotal)}</strong>
          <small>Documentos financieros emitidos en USD</small>
        </article>
      </section>

      <div className={`${styles.reportGrid} ${styles.reportChartsGrid}`}>
        <Panel
          title="Distribución de vuelos"
          description="Estado actual de los vuelos registrados en el periodo."
        >
          {report.statusRows.length === 0 ? (
            <p className={styles.muted}>No hay vuelos para representar en este periodo.</p>
          ) : (
            <>
              <div
                className={styles.barChart}
                role="img"
                aria-label={report.statusRows
                  .map((item) => `${statusLabel(item.status)}: ${item.count}`)
                  .join(", ")}
              >
                {report.statusRows.map((item) => (
                  <div className={styles.barRow} key={item.status} aria-hidden="true">
                    <span>{statusLabel(item.status)}</span>
                    <span className={styles.barTrack}>
                      <i style={chartStyle(percent(item.count, report.flights.length))} />
                    </span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
              <details className={styles.chartDataToggle}>
                <summary>Ver datos de la gráfica en tabla</summary>
                <div className={styles.tableWrap}>
                  <table className={`${styles.table} ${styles.reportDataTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Estado</th>
                        <th scope="col" className={styles.number}>Vuelos</th>
                        <th scope="col" className={styles.number}>Participación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.statusRows.map((item) => (
                        <tr key={item.status}>
                          <td>{statusLabel(item.status)}</td>
                          <td className={styles.number}>{item.count}</td>
                          <td className={styles.number}>
                            {percent(item.count, report.flights.length)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Panel>

        <Panel
          title="Ejecución por servicio"
          description="Porcentaje ejecutado sobre el volumen contratado."
        >
          {report.serviceRows.length === 0 ? (
            <p className={styles.muted}>No hay servicios para representar en este periodo.</p>
          ) : (
            <>
              <div
                className={styles.barChart}
                role="img"
                aria-label={report.serviceRows
                  .map((item) => `${item.name}: ${item.compliance}%`)
                  .join(", ")}
              >
                {report.serviceRows.map((item) => (
                  <div className={styles.barRow} key={item.code} aria-hidden="true">
                    <span>{item.name}</span>
                    <span className={styles.barTrack}>
                      <i style={chartStyle(item.compliance)} />
                    </span>
                    <strong>{item.compliance}%</strong>
                  </div>
                ))}
              </div>
              <details className={styles.chartDataToggle}>
                <summary>Ver datos de la gráfica en tabla</summary>
                <div className={styles.tableWrap}>
                  <table className={`${styles.table} ${styles.reportDataTable}`}>
                    <thead>
                      <tr>
                        <th scope="col">Servicio</th>
                        <th scope="col" className={styles.number}>Contratado</th>
                        <th scope="col" className={styles.number}>Ejecutado</th>
                        <th scope="col" className={styles.number}>Cumplimiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.serviceRows.map((item) => (
                        <tr key={item.code}>
                          <td className={styles.cellMain}>
                            <strong>{item.name}</strong>
                            <span>{item.code}</span>
                          </td>
                          <td className={styles.number}>{item.contractedQuantity}</td>
                          <td className={styles.number}>{item.executedQuantity}</td>
                          <td className={styles.number}>{item.compliance}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Panel>
      </div>

      <div className={styles.reportGrid}>
        <article className={styles.reportInsightCard}>
          <ChartIcon />
          <div>
            <span>Incidencias operativas</span>
            <strong>{report.incidents}</strong>
            <p>Registradas en {report.operations.length} operaciones del periodo.</p>
          </div>
        </article>
        <article className={styles.reportInsightCard}>
          <ChartIcon />
          <div>
            <span>Variación conciliada</span>
            <strong>{formatMoney(report.varianceTotal)}</strong>
            <p>Impacto neto informado en {report.reconciliations.length} conciliaciones.</p>
          </div>
        </article>
        <article className={styles.reportInsightCard}>
          <ChartIcon />
          <div>
            <span>Documentos financieros</span>
            <strong>{report.invoices.length}</strong>
            <p>Prefacturas y facturas incluidas en la exportación.</p>
          </div>
        </article>
      </div>
    </div>
  );
}

export default PortalReports;
