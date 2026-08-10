"use client";

import { useState, type FormEvent } from "react";

import { downloadPortalCsv } from "@/lib/portal-documents";
import type { Invoice, Reconciliation } from "@/lib/portal";

import { AlertIcon, CheckIcon, FinanceIcon, SearchIcon } from "./PortalIcons";
import {
  EmptyState,
  Feedback,
  Field,
  Panel,
  PortalModal,
  PortalPageHeader,
  Provenance,
  StatusBadge,
  formatDate,
  formatDateTime,
  formatMoney,
  portalModuleStyles as styles,
} from "./PortalModuleUI";
import { usePortalWorkspace } from "./PortalWorkspace";

type FinanceTab = "prebills" | "invoices" | "reconciliations" | "cases";
type FinanceDialog =
  | { kind: "accept-prebill"; id: string }
  | { kind: "dispute-prebill"; id: string }
  | { kind: "claim-invoice"; id: string }
  | { kind: "accept-reconciliation"; id: string }
  | { kind: "dispute-reconciliation"; id: string };

const CASE_LABELS = {
  PREBILL_DISPUTE: "Disputa de prefactura",
  RECONCILIATION_DISPUTE: "Disputa de conciliación",
  INVOICE_CLAIM: "Reclamo de factura",
} as const;

function InvoiceCard({
  invoice,
  onAction,
  timeMode,
}: {
  invoice: Invoice;
  onAction: (dialog: FinanceDialog) => void;
  timeMode: "AIRPORT" | "UTC";
}) {
  const isPrebill = invoice.kind === "PREBILL";
  const canRespond = isPrebill && invoice.status === "PENDING_REVIEW";
  const canClaim = !isPrebill && ["ISSUED", "OVERDUE"].includes(invoice.status);

  return (
    <article className={styles.dataCard}>
      <div className={styles.dataCardHeader}>
        <div>
          <p className={styles.eyebrow}>{isPrebill ? "Prefactura" : "Factura"}</p>
          <h2>{invoice.invoiceNumber}</h2>
          <p>
            Periodo {formatDate(invoice.periodStart)} — {formatDate(invoice.periodEnd)}
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      <dl className={styles.definitionGrid}>
        <div>
          <dt>Emitida</dt>
          <dd>{formatDateTime(invoice.issuedAt, timeMode)}</dd>
        </div>
        <div>
          <dt>Vencimiento</dt>
          <dd>{invoice.dueAt ? formatDate(invoice.dueAt) : "No aplica"}</dd>
        </div>
        <div>
          <dt>Subtotal</dt>
          <dd>{formatMoney(invoice.subtotal, invoice.currency)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd className={styles.amount}>{formatMoney(invoice.total, invoice.currency)}</dd>
        </div>
      </dl>

      <details className={styles.detailToggle}>
        <summary>Consultar {invoice.lines.length} línea(s) de servicio</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>Detalle de {invoice.invoiceNumber}</caption>
            <thead>
              <tr>
                <th scope="col">Concepto</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Precio unitario</th>
                <th scope="col">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.id}>
                  <td className={styles.cellMain}>
                    <strong>{line.description}</strong>
                    <span>{line.operationId ?? "Sin operación asociada"}</span>
                  </td>
                  <td className={styles.number}>{line.quantity}</td>
                  <td className={styles.number}>{formatMoney(line.unitPrice, invoice.currency)}</td>
                  <td className={styles.number}>{formatMoney(line.subtotal, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {invoice.responseNote && (
        <Feedback tone={invoice.status === "DISPUTED" ? "error" : "info"}>
          Respuesta registrada: {invoice.responseNote}
        </Feedback>
      )}

      <div className={styles.cardFooter}>
        <Provenance value={invoice.provenance} />
        {(canRespond || canClaim) && (
          <div className={styles.actionsRow}>
            {canRespond && (
              <>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => onAction({ kind: "dispute-prebill", id: invoice.id })}
                >
                  <AlertIcon /> Disputar líneas
                </button>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => onAction({ kind: "accept-prebill", id: invoice.id })}
                >
                  <CheckIcon /> Aceptar prefactura
                </button>
              </>
            )}
            {canClaim && (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => onAction({ kind: "claim-invoice", id: invoice.id })}
              >
                <AlertIcon /> Abrir reclamo
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function ReconciliationCard({
  reconciliation,
  onAction,
  timeMode,
}: {
  reconciliation: Reconciliation;
  onAction: (dialog: FinanceDialog) => void;
  timeMode: "AIRPORT" | "UTC";
}) {
  const canRespond = ["PENDING_REVIEW", "MATCHED"].includes(reconciliation.status);
  return (
    <article className={styles.dataCard}>
      <div className={styles.dataCardHeader}>
        <div>
          <p className={styles.eyebrow}>Conciliación operativa</p>
          <h2>{reconciliation.operationId}</h2>
          <p>{reconciliation.station} · {formatDate(reconciliation.periodStart)}</p>
        </div>
        <StatusBadge status={reconciliation.status} />
      </div>

      <dl className={styles.definitionGrid}>
        <div>
          <dt>Diferencias</dt>
          <dd>{reconciliation.differences.length}</dd>
        </div>
        <div>
          <dt>Impacto estimado</dt>
          <dd className={styles.amount}>
            {formatMoney(reconciliation.varianceAmount, reconciliation.currency)}
          </dd>
        </div>
      </dl>

      <details className={styles.detailToggle}>
        <summary>Ver comparación contratado vs. ejecutado</summary>
        {reconciliation.differences.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.visuallyHidden}>Diferencias de conciliación</caption>
              <thead>
                <tr>
                  <th scope="col">Servicio</th>
                  <th scope="col">Contratado</th>
                  <th scope="col">Ejecutado</th>
                  <th scope="col">Impacto</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.differences.map((difference) => (
                  <tr key={difference.serviceCode}>
                    <td className={styles.cellMain}>
                      <strong>{difference.description}</strong>
                      <span>{difference.serviceCode}</span>
                    </td>
                    <td className={styles.number}>{difference.contractedQuantity}</td>
                    <td className={styles.number}>{difference.executedQuantity}</td>
                    <td className={styles.number}>
                      {formatMoney(difference.amountImpact, reconciliation.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Feedback tone="success">No se detectaron diferencias para esta operación.</Feedback>
        )}
      </details>

      <div className={styles.cardFooter}>
        <Provenance value={reconciliation.provenance} />
        {canRespond && (
          <div className={styles.actionsRow}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => onAction({ kind: "dispute-reconciliation", id: reconciliation.id })}
            >
              Disputar
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => onAction({ kind: "accept-reconciliation", id: reconciliation.id })}
            >
              <CheckIcon /> Confirmar
            </button>
          </div>
        )}
      </div>
      {reconciliation.respondedAt && (
        <p className={styles.muted}>
          Respondida {formatDateTime(reconciliation.respondedAt, timeMode)}
        </p>
      )}
    </article>
  );
}

export function PortalFinance() {
  const { data, mutate, timeMode } = usePortalWorkspace();
  const [tab, setTab] = useState<FinanceTab>("prebills");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<FinanceDialog | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const prebills = data.invoices.filter((invoice) => invoice.kind === "PREBILL");
  const invoices = data.invoices.filter((invoice) => invoice.kind === "INVOICE");
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  const visibleInvoices = (tab === "prebills" ? prebills : invoices).filter((invoice) =>
    [invoice.invoiceNumber, invoice.status, invoice.periodStart, invoice.periodEnd]
      .join(" ")
      .toLocaleLowerCase("es")
      .includes(normalizedQuery),
  );

  const outstanding = invoices
    .filter((invoice) => ["ISSUED", "OVERDUE"].includes(invoice.status))
    .reduce((sum, invoice) => sum + invoice.total, 0);
  const totals = {
    outstanding,
    pending: prebills.filter((invoice) => invoice.status === "PENDING_REVIEW").length,
    reconciliations: data.reconciliations.filter((item) =>
      ["PENDING_REVIEW", "MATCHED"].includes(item.status),
    ).length,
    cases: data.billingCases.filter((item) => !["RESOLVED", "CLOSED"].includes(item.status)).length,
  };

  const exportFinance = () => {
    downloadPortalCsv(
      "elevant-consulta-financiera",
      ["Tipo", "Número", "Periodo inicio", "Periodo fin", "Estado", "Moneda", "Subtotal", "Impuesto", "Total"],
      data.invoices.map((invoice) => [
        invoice.kind,
        invoice.invoiceNumber,
        invoice.periodStart,
        invoice.periodEnd,
        invoice.status,
        invoice.currency,
        invoice.subtotal,
        invoice.tax,
        invoice.total,
      ]),
    );
    setFeedback({ tone: "success", message: "Consulta financiera exportada en CSV." });
  };

  const finishAction = (result: ReturnType<typeof mutate>, successMessage: string) => {
    if (!result.ok) {
      setFeedback({ tone: "error", message: result.message });
      return;
    }
    setFeedback({ tone: "success", message: successMessage });
    setDialog(null);
  };

  const submitDialog = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    const note = String(form.get("note") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const lineIds = form.getAll("lineIds").map(String);

    if (dialog.kind === "accept-prebill") {
      finishAction(
        mutate((repository) => repository.acceptPrebill(dialog.id, note || undefined)),
        "Prefactura aceptada y registrada en la auditoría.",
      );
    } else if (dialog.kind === "dispute-prebill") {
      finishAction(
        mutate((repository) =>
          repository.disputePrebill(dialog.id, { reason: description, subject, lineIds }),
        ),
        "Disputa creada. El equipo financiero dará seguimiento al caso.",
      );
      setTab("cases");
    } else if (dialog.kind === "claim-invoice") {
      finishAction(
        mutate((repository) => repository.claimInvoice(dialog.id, { subject, description })),
        "Reclamo registrado con su trazabilidad.",
      );
      setTab("cases");
    } else if (dialog.kind === "accept-reconciliation") {
      finishAction(
        mutate((repository) => repository.acceptReconciliation(dialog.id, note || undefined)),
        "Conciliación confirmada.",
      );
    } else {
      finishAction(
        mutate((repository) =>
          repository.disputeReconciliation(dialog.id, { reason: description, subject, lineIds }),
        ),
        "Disputa de conciliación registrada.",
      );
      setTab("cases");
    }
  };

  const dialogInvoice = dialog && "id" in dialog ? data.invoices.find((item) => item.id === dialog.id) : undefined;
  const dialogReconciliation = dialog && "id" in dialog
    ? data.reconciliations.find((item) => item.id === dialog.id)
    : undefined;
  const isDispute = dialog?.kind === "dispute-prebill" || dialog?.kind === "dispute-reconciliation";
  const isClaim = dialog?.kind === "claim-invoice";

  return (
    <div className={styles.page}>
      <PortalPageHeader
        eyebrow="Consulta financiera"
        title="Finanzas claras, respuesta controlada."
        description="Consulta prefacturas, facturas y conciliaciones. Los importes son de solo lectura; únicamente puedes aceptar, disputar o abrir un reclamo con trazabilidad."
        actions={
          <button className={styles.secondaryButton} type="button" onClick={exportFinance}>
            <FinanceIcon /> Exportar consulta
          </button>
        }
      />

      {feedback && <Feedback tone={feedback.tone}>{feedback.message}</Feedback>}

      <section className={styles.metricGrid} aria-label="Resumen financiero">
        <article className={styles.metricCard}>
          <span>Saldo consultado</span>
          <strong>{formatMoney(totals.outstanding)}</strong>
          <small>Facturas emitidas o vencidas</small>
        </article>
        <article className={styles.metricCard}>
          <span>Prefacturas por revisar</span>
          <strong>{totals.pending}</strong>
          <small>Requieren respuesta de la aerolínea</small>
        </article>
        <article className={styles.metricCard}>
          <span>Conciliaciones pendientes</span>
          <strong>{totals.reconciliations}</strong>
          <small>Comparación contratado vs. ejecutado</small>
        </article>
        <article className={styles.metricCard}>
          <span>Casos abiertos</span>
          <strong>{totals.cases}</strong>
          <small>Disputas y reclamos en seguimiento</small>
        </article>
      </section>

      <div className={styles.tabs} role="tablist" aria-label="Secciones financieras">
        {([
          ["prebills", `Prefacturas (${prebills.length})`],
          ["invoices", `Facturas (${invoices.length})`],
          ["reconciliations", `Conciliaciones (${data.reconciliations.length})`],
          ["cases", `Casos (${data.billingCases.length})`],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "prebills" || tab === "invoices") && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.searchControl}>
              <SearchIcon />
              <label className={styles.visuallyHidden} htmlFor="finance-search">Buscar documento financiero</label>
              <input
                id="finance-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por número, periodo o estado"
              />
            </div>
          </div>
          <div className={styles.stack} role="tabpanel">
            {visibleInvoices.length ? (
              visibleInvoices.map((invoice) => (
                <InvoiceCard key={invoice.id} invoice={invoice} onAction={setDialog} timeMode={timeMode} />
              ))
            ) : (
              <Panel><EmptyState title="Sin resultados" description="Ajusta la búsqueda para consultar otros documentos financieros." /></Panel>
            )}
          </div>
        </>
      )}

      {tab === "reconciliations" && (
        <div className={styles.stack} role="tabpanel">
          {data.reconciliations.map((reconciliation) => (
            <ReconciliationCard
              key={reconciliation.id}
              reconciliation={reconciliation}
              onAction={setDialog}
              timeMode={timeMode}
            />
          ))}
        </div>
      )}

      {tab === "cases" && (
        <div className={styles.stack} role="tabpanel">
          {data.billingCases.length ? (
            data.billingCases.map((billingCase) => (
              <article className={styles.dataCard} key={billingCase.id}>
                <div className={styles.dataCardHeader}>
                  <div>
                    <p className={styles.eyebrow}>{CASE_LABELS[billingCase.type]}</p>
                    <h2>{billingCase.subject}</h2>
                    <p>{billingCase.id}</p>
                  </div>
                  <StatusBadge status={billingCase.status} />
                </div>
                <p className={styles.pageDescription}>{billingCase.description}</p>
                <dl className={styles.definitionGrid}>
                  <div><dt>Creado</dt><dd>{formatDateTime(billingCase.createdAt, timeMode)}</dd></div>
                  <div><dt>Líneas observadas</dt><dd>{billingCase.lineIds.length || "Documento completo"}</dd></div>
                </dl>
                <Provenance value={billingCase.provenance} />
              </article>
            ))
          ) : (
            <Panel><EmptyState title="Sin casos abiertos" description="Las disputas y reclamos que registres aparecerán aquí con su trazabilidad." /></Panel>
          )}
        </div>
      )}

      {dialog && (
        <PortalModal
          title={
            dialog.kind === "accept-prebill" ? "Aceptar prefactura" :
            dialog.kind === "dispute-prebill" ? "Disputar prefactura" :
            dialog.kind === "claim-invoice" ? "Abrir reclamo" :
            dialog.kind === "accept-reconciliation" ? "Confirmar conciliación" :
            "Disputar conciliación"
          }
          description="Esta acción no modifica importes. Registra una respuesta auditable para seguimiento de AVIAM."
          onClose={() => setDialog(null)}
        >
          <form className={styles.modalForm} onSubmit={submitDialog}>
            {(isDispute || isClaim) && (
              <Field label="Asunto" htmlFor="finance-subject" required>
                <input id="finance-subject" name="subject" maxLength={160} required defaultValue={isClaim ? `Reclamo ${dialogInvoice?.invoiceNumber ?? ""}` : "Diferencia encontrada"} />
              </Field>
            )}
            {dialog.kind === "dispute-prebill" && dialogInvoice && (
              <fieldset className={styles.field}>
                <legend>Líneas a disputar</legend>
                <div className={styles.checkboxList}>
                  {dialogInvoice.lines.map((line) => (
                    <label key={line.id}>
                      <input type="checkbox" name="lineIds" value={line.id} />
                      <span>{line.description}</span>
                      <strong>{formatMoney(line.subtotal, dialogInvoice.currency)}</strong>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {dialog.kind === "dispute-reconciliation" && dialogReconciliation && (
              <fieldset className={styles.field}>
                <legend>Diferencias observadas</legend>
                <div className={styles.checkboxList}>
                  {dialogReconciliation.differences.map((difference) => (
                    <label key={difference.serviceCode}>
                      <input type="checkbox" name="lineIds" value={difference.serviceCode} />
                      <span>{difference.description}</span>
                      <strong>{formatMoney(difference.amountImpact, dialogReconciliation.currency)}</strong>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {(isDispute || isClaim) ? (
              <Field label="Motivo y evidencia de la observación" htmlFor="finance-description" required>
                <textarea id="finance-description" name="description" maxLength={1_000} required placeholder="Describe la diferencia y la referencia que AVIAM debe revisar." />
              </Field>
            ) : (
              <Field label="Nota de confirmación" htmlFor="finance-note" hint="Opcional; se guardará junto a la respuesta.">
                <textarea id="finance-note" name="note" maxLength={1_000} placeholder="Añade una referencia interna si la necesitas." />
              </Field>
            )}
            <div className={styles.modalActions}>
              <button className={styles.ghostButton} type="button" onClick={() => setDialog(null)}>Cancelar</button>
              <button className={isDispute || isClaim ? styles.dangerButton : styles.primaryButton} type="submit">
                {isDispute || isClaim ? "Registrar caso" : "Confirmar respuesta"}
              </button>
            </div>
          </form>
        </PortalModal>
      )}
    </div>
  );
}
