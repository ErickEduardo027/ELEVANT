import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { call, expectCall, login } from "./support/api";
import { goPrivate, loginPortal, loginPrivate, snap } from "./support/browser";
import { API, loadRun, saveRun } from "./support/env";
import { waitForEmail } from "./support/mailpit";
import { pdfText } from "./support/pdf";

// Fase 4 · Facturación: Finanzas invoices the run's approved operation (simulated e-CF), the airline
// pays it by card in its portal (a declined card first, then an approved one, against the simulated
// gateway) and gets the receipt, and Finanzas sees the card payment. Then (block C) Treasury cannot
// reverse that card receipt, Finanzas credits part of the invoice with an E34 note that reaches the
// airline by email, and the portal shows the note and the credit in its favour. Finally (block D)
// Cuentas por pagar corrects, voids and reuses an NCF under segregation of duties, and an OCC
// expense is reviewed by escalation in Finance. The card numbers are the public test numbers of the
// simulated gateway; no screenshot is taken while they are typed.

const DECLINED = "4000 0000 0000 0002";
const APPROVED = "4111 1111 1111 1111";
const localDay = () => new Date().toLocaleDateString("en-CA");
// 4-N10: Finance dates by the business day of Santo Domingo, whatever the zone of the machine or UTC.
const businessDay = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric",
  month: "2-digit", day: "2-digit" }).format(at);

type IssueBody = { stationId: string; operationIds: string[]; requestId: string;
  operationVersions?: Array<{ operationId: string; version: string }> };

async function openFinance(page: Page, label: string) {
  await page.getByRole("button", { name: /^Facturación/ }).first().click().catch(() => undefined);
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await fetch(`${API}/health`).catch(() => null);
  test.skip(!health?.ok, "The local stack is not running.");
});

test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

test("Finanzas factura la operación aprobada (e-CF simulado)", async ({ page }) => {
  const run = loadRun();
  const flight = run.flight as { operationCode: string };
  const airline = run.airline as { name: string };
  if (run.invoice) return; // resumed run: already invoiced
  await loginPrivate(page, "finance");
  // 4-N26: OCC's approval left Finance one alert of the airline, station and day in the bell.
  await page.getByRole("button", { name: "Notificaciones" }).first().click();
  const bell = page.getByRole("dialog", { name: "Notificaciones" });
  await expect(bell.getByText("OCC aprobó operaciones listas para facturar").first()).toBeVisible();
  await expect(bell.getByText(airline.name, { exact: false }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await openFinance(page, "Por facturar");
  // 4-N06: the limits of one invoice are on screen; 4-N16: the dates are optional filters of what is pending.
  await expect(page.getByRole("region", { name: "Límites de una factura" })).toContainText("100 operaciones, 500 líneas");
  await page.getByLabel("Operaciones desde").fill(localDay());
  await page.getByLabel("Operaciones hasta").fill(localDay());
  const row = page.getByRole("checkbox", { name: `Seleccionar ${flight.operationCode}` });
  await expect(row, "the approved operation reaches «Por facturar»").toBeVisible();
  await expect(page.getByText(/Mostrando \d+ de \d+ pendientes\./)).toBeVisible();
  await row.check();
  await expect(page.getByRole("region", { name: "Resumen de la factura" })).toContainText("de 500 líneas");
  await snap(page, "fase4-finanzas-por-facturar");
  const sent = page.waitForRequest(request => request.method() === "POST" &&
    request.url().includes("/api/v1/finance/invoices/from-operations"));
  await page.getByRole("button", { name: "Emitir factura" }).click();
  const body = (await sent).postDataJSON() as IssueBody;
  // 4-N29: the screen sends the version of each operation it showed.
  expect(body.operationVersions?.map(item => item.operationId)).toEqual(body.operationIds);
  const issued = page.getByRole("region", { name: "Factura emitida" });
  await expect(issued).toBeVisible();
  const title = (await issued.getByRole("heading").innerText()).trim();
  expect(title).toMatch(/^e-NCF E31\d{10}$/);
  const download = page.waitForEvent("download");
  await issued.getByRole("button", { name: "Descargar PDF" }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  // 4-N10: EMISIÓN is the business day of Santo Domingo, not the UTC day.
  const text = pdfText(fs.readFileSync(await pdf.path()));
  expect(text).toContain("EMISIÓN");
  expect(text).toContain(businessDay());
  await snap(page, "fase4-finanzas-factura-emitida");

  const token = await login("finance");
  // 4-N16: what stays pending comes from the oldest to the newest, without the operation just invoiced.
  const pending = await call<{ limits: unknown; operations: Array<{ operationDate: string; operationCode: string }> }>(token,
    "GET", `/finance/invoicing/pending-operations?stationId=${body.stationId}`);
  expect(pending.status).toBe(200);
  expect(pending.data.limits).toEqual({ maxOperations: 100, maxLines: 500, maxDays: 31 });
  const days = pending.data.operations.map(item => item.operationDate);
  expect([...days].sort()).toEqual(days);
  expect(pending.data.operations.some(item => item.operationCode === flight.operationCode)).toBe(false);
  // 4-N29 and 4-N01: the same request id with another operation is a conflict, never the earlier invoice; the same
  // body replays it.
  const reused = await call<{ code?: string }>(token, "POST", "/finance/invoices/from-operations",
    { stationId: body.stationId, requestId: body.requestId, operationIds: [randomUUID()] });
  expect(reused.status).toBe(409);
  expect(reused.data.code).toBe("idempotency_conflict");
  const replay = await call<{ replayed: boolean; fiscalNumber: string }>(token, "POST", "/finance/invoices/from-operations", body);
  expect(replay.status).toBe(200);
  expect(replay.data.replayed).toBe(true);
  expect(`e-NCF ${replay.data.fiscalNumber}`).toBe(title);
  saveRun({ invoice: { fiscalNumber: title.replace("e-NCF ", "") } });
});

test("La aerolínea paga la factura con tarjeta en su portal: una rechazada y una aprobada", async ({ page }) => {
  const run = loadRun();
  const invoice = run.invoice as { fiscalNumber: string };
  await loginPortal(page, (run.representative as { email: string }).email);
  await page.getByRole("link", { name: "Facturas", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Facturas" })).toBeVisible();
  const card = page.getByRole("region", { name: `Factura ${invoice.fiscalNumber}` });
  await expect(card).toBeVisible();
  if (!(await card.innerText()).includes("Pagada")) {
    await card.getByRole("button", { name: "Ver detalle" }).click();
    const detail = page.getByRole("region", { name: "Detalle de factura" });
    await detail.getByRole("button", { name: /^Pagar con tarjeta/ }).click();
    const form = page.getByRole("form", { name: "Datos de la tarjeta" });
    await snap(page, "fase4-portal-pago");
    await form.getByLabel("Titular de la tarjeta").fill("Rosa Martinez Prueba");
    await form.getByLabel("Número de tarjeta").fill(DECLINED);
    await form.getByLabel("Vencimiento (MM/AA)").fill("12/30");
    await form.getByLabel("Código de seguridad").fill("123");
    await form.getByRole("button", { name: /^Pagar / }).click();
    await expect(page.getByText("fondos insuficientes").first()).toBeVisible();
    await form.getByLabel("Número de tarjeta").fill(APPROVED);
    await form.getByLabel("Código de seguridad").fill("123");
    await form.getByRole("button", { name: /^Pagar / }).click();
    await expect(page.getByText(/Pago aprobado · Visa terminada en 1111/)).toBeVisible();
  }
  await expect(page.getByText("Pagada").first()).toBeVisible();
  await snap(page, "fase4-portal-pagada");
  const receipt = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar recibo" }).first().click();
  expect((await receipt).suggestedFilename()).toMatch(/\.pdf$/);
});

test("Finanzas ve el pago con tarjeta y la factura cobrada", async ({ page }) => {
  const run = loadRun();
  const invoice = run.invoice as { fiscalNumber: string };
  await loginPrivate(page, "finance");
  await openFinance(page, "Facturas");
  await page.getByRole("button", { name: invoice.fiscalNumber }).click();
  const payments = page.getByRole("region", { name: "Pagos con tarjeta" });
  await expect(payments.getByText("Visa •••• 1111")).toBeVisible();
  // Card data never comes back: Finanzas sees only the brand and the last 4 digits.
  expect(await page.content()).not.toMatch(/4111\s?1111\s?1111|4000\s?0000\s?0000\s?0002/);
  await snap(page, "fase4-finanzas-pago-tarjeta");
});

type LedgerInvoice = { id: string; airlineId: string; stationId: string; fiscalNumber: string | null };
type TreasuryReceipt = { id: string; reference: string; method: string; version: string;
  movements: Array<{ id: string; kind: string; invoiceId: string | null }> };

test("Tesorería no revierte ni devuelve el cobro con tarjeta: se corrige con una nota de crédito (4-N09)", async ({ page }) => {
  const run = loadRun();
  const invoice = run.invoice as { fiscalNumber: string };
  const airline = run.airline as { name: string };
  const token = await login("finance");
  const found = await expectCall<{ invoices: LedgerInvoice[] }>(200, token, "GET",
    `/finance/invoices?search=${encodeURIComponent(invoice.fiscalNumber)}&limit=25`);
  const summary = found.data.invoices[0];
  const receipts = await expectCall<{ items: TreasuryReceipt[] }>(200, token, "GET",
    `/finance/receipts?page=1&limit=25&stationId=${summary.stationId}&airlineId=${summary.airlineId}`);
  const applied = (receipt: TreasuryReceipt) => receipt.movements.find(movement => movement.kind === "Application" &&
    movement.invoiceId === summary.id);
  const card = receipts.data.items.find(receipt => receipt.method === "Card" && applied(receipt));
  expect(card, "the approved card payment left its receipt applied to the invoice").toBeTruthy();
  // Neither the application, nor the whole receipt, nor a refund: the portal's receipt never contradicts the invoice.
  const base = { expectedVersion: card!.version, effectiveOn: businessDay(), reason: "Ciclo E2E: un cobro con tarjeta no se revierte" };
  const attempts: Array<[string, Record<string, unknown>]> = [
    [`/finance/receipts/${card!.id}/reversals`, { ...base, requestId: randomUUID(), applicationId: applied(card!)!.id }],
    [`/finance/receipts/${card!.id}/reversals`, { ...base, requestId: randomUUID() }],
    [`/finance/receipts/${card!.id}/refunds`, { ...base, requestId: randomUUID(), amount: 1, reference: "E2E-DEVOLUCION" }],
  ];
  for (const [route, body] of attempts) {
    const refused = await expectCall<{ code?: string }>(409, token, "POST", route, body);
    expect(refused.data.code, route).toBe("card_payment_not_reversible");
  }

  await loginPrivate(page, "finance");
  await openFinance(page, "Facturas");
  await page.getByRole("tab", { name: "Cobros" }).click();
  const receiptsPanel = page.getByRole("tabpanel", { name: "Cobros" });
  await receiptsPanel.getByRole("combobox", { name: /^Aerolínea/ }).selectOption({ label: airline.name });
  await receiptsPanel.getByRole("button", { name: `Ver ${card!.reference}` }).click();
  const drawer = page.getByRole("dialog", { name: `Cobro ${card!.reference}` });
  await expect(drawer.getByText(/no se revierte ni se devuelve/)).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Revertir|Devolver remanente/ })).toHaveCount(0);
  await snap(page, "fase4-finanzas-cobro-tarjeta-no-reversible");
});

test("Finanzas emite una nota de crédito E34 con su PDF y la aerolínea recibe el aviso sin saldo (4-N17, 4-N23)", async ({ page }) => {
  const run = loadRun();
  const invoice = run.invoice as { fiscalNumber: string };
  const representative = run.representative as { email: string };
  if (run.creditNote) return; // resumed run: already credited
  await loginPrivate(page, "finance");
  await openFinance(page, "Facturas");
  await page.getByRole("button", { name: invoice.fiscalNumber }).click();
  const notes = page.getByRole("region", { name: "Notas de ajuste" });
  await notes.getByRole("button", { name: "Emitir nota" }).click();
  const dialog = page.getByRole("dialog", { name: "Emitir nota de ajuste" });
  const quantity = dialog.getByLabel(/Cantidad línea 1/);
  const amountField = dialog.getByLabel(/Importe línea 1/);
  const maxQuantity = Number(await quantity.getAttribute("max"));
  const maxAmount = Number(await amountField.getAttribute("max"));
  expect(maxAmount, "the paid invoice still admits a credit on its first line").toBeGreaterThan(1);
  // A partial credit of the paid invoice: at most half of the line, so the airline keeps a credit in its favour.
  const credit = Math.min(10, Math.floor(maxAmount * 50) / 100);
  await quantity.fill(maxQuantity > 0 ? String(Math.min(maxQuantity, 1)) : "0");
  await amountField.fill(credit.toFixed(2));
  await dialog.getByLabel("Motivo").fill("Ciclo E2E: servicio prestado parcialmente");
  const since = Date.now();
  await dialog.getByRole("button", { name: "Confirmar nota" }).click();
  // 4-N17: a note on an E31 invoice gets its own simulated e-NCF, E34 for a credit.
  const notice = notes.getByRole("status").filter({ hasText: "emitida" });
  await expect(notice).toHaveText(/^Nota de crédito electrónica E34\d{10} emitida\./);
  const number = /E34\d{10}/.exec(await notice.innerText())![0];
  const download = page.waitForEvent("download");
  await notes.getByRole("button", { name: `Descargar PDF de Nota de crédito electrónica ${number}` }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe(`nota-${number}.pdf`);
  const text = pdfText(fs.readFileSync(await pdf.path()));
  expect(text).toContain(`e-NCF ${number}`);
  expect(text).toContain(`Modifica: ${invoice.fiscalNumber}`);
  expect(text).toMatch(/Simulaci.n . sin validez fiscal/);
  await snap(page, "fase4-finanzas-nota-credito");

  // 4-N23: the airline is told of the note with its PDF, and the email states no balance that could contradict it.
  const email = await waitForEmail(representative.email, new RegExp(`Nota de crédito ${number}`), since);
  expect(email.subject).toContain(invoice.fiscalNumber);
  expect(email.attachments.map(item => item.FileName)).toContain(`nota-${number}.pdf`);
  expect(email.text).not.toMatch(/saldo[^.\n]*\d/i);
  expect(email.text).toMatch(/Simulaci.n . sin validez fiscal/);
  saveRun({ creditNote: { number, amount: credit } });
});

test("El portal muestra la nota y el saldo a favor en «Estado de cuenta» y no vacía la lista al revalidar (4-N17, 4-N24, 4-N25, 4-N30)", async ({ page }) => {
  const run = loadRun();
  const invoice = run.invoice as { fiscalNumber: string };
  const note = run.creditNote as { number: string } | undefined;
  test.skip(!note, "The credit note of this run was not issued.");
  await loginPortal(page, (run.representative as { email: string }).email);
  await page.getByRole("link", { name: "Facturas", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Facturas" })).toBeVisible();
  const card = page.getByRole("region", { name: `Factura ${invoice.fiscalNumber}` });
  // 4-N24: paid by card and credited afterwards, it is «Pagada», never «Anulada».
  await expect(card).toContainText("Pagada");
  const favour = page.getByLabel("Resumen de facturas").getByText("Saldo a favor", { exact: true })
    .locator("xpath=following-sibling::strong[1]");
  await expect(favour).toHaveText(/^(USD|DOP) \d/);

  // 4-N25: the periodic refresh (25 s) and the focus keep the invoices and their PDF on screen.
  const invoicePdf = card.getByRole("button", { name: `Descargar PDF de Factura ${invoice.fiscalNumber}` });
  for (let second = 0; second < 30; second += 1) {
    await expect(invoicePdf).toBeVisible();
    await expect(page.getByText("Cargando facturas autorizadas…")).toHaveCount(0);
    await page.waitForTimeout(1_000);
  }
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect(invoicePdf).toBeVisible();
  await expect(page.getByText("Cargando facturas autorizadas…")).toHaveCount(0);

  // 4-N30: «Estado de cuenta» is a view of the same page, with the credit in the airline's favour.
  await page.getByRole("button", { name: "Estado de cuenta" }).click();
  const statement = page.getByRole("region", { name: "Estado de cuenta de aerolínea" });
  const credit = statement.getByText("Crédito a favor", { exact: true }).first().locator("xpath=following-sibling::strong[1]");
  await expect(credit).toHaveText(/^(USD|DOP) \d/);
  expect(Number((await credit.innerText()).replace(/^[A-Z]{3}\s/, "").replace(/,/g, ""))).toBeGreaterThan(0);
  await snap(page, "fase4-portal-estado-de-cuenta");
  await statement.getByRole("button", { name: `Ver factura ${invoice.fiscalNumber}` }).click();
  const noteCard = statement.getByRole("article", { name: `Nota de crédito electrónica ${note!.number}` });
  await expect(noteCard).toBeVisible();
  const download = page.waitForEvent("download");
  await noteCard.getByRole("button", { name: `Descargar PDF de Nota de crédito electrónica ${note!.number}` }).click();
  expect((await download).suggestedFilename()).toBe(`nota-${note!.number}.pdf`);
  await snap(page, "fase4-portal-nota-credito");
});

test("El charter ve su factura y su prepago en el portal (4-N08, 4-N22)", async ({ page }) => {
  const run = loadRun();
  const charter = run.charter as { representativeEmail: string; fiscalNumber: string } | undefined;
  // The cycle's phase 3 operates a contracted flight, not a charter: without one, the SQL integration tests
  // (SqlServerMigrationTests.FinanceTreasuryPortal and .CharterPrepayment) cover the portal scope and the prepayment.
  test.skip(!charter, "La corrida de la fase 3 no deja un charter facturado.");
  await loginPortal(page, charter!.representativeEmail);
  await page.getByRole("link", { name: "Facturas", exact: true }).first().click();
  await expect(page.getByRole("region", { name: `Factura ${charter!.fiscalNumber}` })).toBeVisible();
  await page.getByRole("button", { name: "Estado de cuenta" }).click();
  await expect(page.getByRole("region", { name: "Estado de cuenta de aerolínea" }).getByText(/^PREPAGO/).first()).toBeVisible();
});

test("Finanzas consulta sus reportes del período", async ({ page }) => {
  await loginPrivate(page, "finance");
  await page.getByRole("navigation").getByRole("button", { name: /^Reportes/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await snap(page, "fase4-finanzas-reportes");
});

test("Finanzas sin prefacturas: menú Inicio · Facturación · Cuentas por pagar · Reportes · Configuración · Usuarios", async ({ page }) => {
  const run = loadRun();
  const invoice = run.invoice as { fiscalNumber: string };
  const token = await login("finance");
  // 4-N21: the ledger finds the run's invoice by its e-NCF; its business day opens the sales book below.
  const found = await expectCall<{ invoices: Array<{ fiscalNumber: string | null; issuedAt: string }> }>(200, token, "GET",
    `/finance/invoices?search=${encodeURIComponent(invoice.fiscalNumber)}&limit=25`);
  expect(found.data.invoices.map(item => item.fiscalNumber)).toEqual([invoice.fiscalNumber]);
  const issuedDay = businessDay(new Date(found.data.invoices[0].issuedAt));
  const tooLong = await expectCall<{ code?: string }>(400, token, "GET", `/finance/invoices?search=${"E".repeat(41)}`);
  expect(tooLong.data.code).toBe("invalid_invoice_query");

  await loginPrivate(page, "finance");
  // 4-A: the first level of the menu is the simplified Finance; the retired modules are gone from it.
  const navigation = page.getByRole("navigation", { name: "Navegación principal" });
  for (const label of [/^Inicio/, /^Facturación/, /^Cuentas por pagar/, /^Reportes/, /^Configuración/, /^Usuarios/])
    await expect(navigation.getByRole("button", { name: label }).first()).toBeVisible();
  for (const retired of [/Pre-facturación/, /Servicios aprobados/, /Tratamientos tributarios/, /Documentos fiscales/,
    /Cobros y aplicaciones/, /^Tarifarios/])
    await expect(navigation.getByRole("button", { name: retired })).toHaveCount(0);
  // 4-A, 4-N02: «Inicio» shows what the server computes for the station, never «sin estación».
  await expect(page.getByRole("heading", { level: 1, name: "Resumen financiero" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Operaciones por facturar" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Por cobrar" })).toBeVisible();
  await expect(page.getByText("No hay una estación financiera autorizada")).toHaveCount(0);
  await snap(page, "fase4-finanzas-inicio");

  // 4-N21: «Facturas» pages by 25 and finds the invoice by its e-NCF from the first page.
  await openFinance(page, "Facturas");
  const pages = page.getByRole("navigation", { name: "Páginas de facturas" });
  await expect(pages.getByRole("button", { name: "Siguiente" })).toBeVisible();
  const searched = page.waitForRequest(request => request.url().includes("/api/v1/finance/invoices?") &&
    new URL(request.url()).searchParams.get("search") === invoice.fiscalNumber);
  await page.getByRole("searchbox", { name: "Buscar (e-NCF, número o aerolínea)" }).fill(invoice.fiscalNumber);
  expect(new URL((await searched).url()).searchParams.get("page")).toBe("1");
  await expect(page.getByRole("button", { name: invoice.fiscalNumber })).toBeVisible();
  await expect(pages.getByText("Página 1")).toBeVisible();
  await snap(page, "fase4-finanzas-facturas-busqueda");
  // 4-N19: «Cobros» and «Estados de cuenta» are tabs of «Facturas»; the statement names the invoice by its e-NCF.
  await expect(page.getByRole("tab", { name: "Cobros" })).toBeVisible();
  await page.getByRole("tab", { name: "Estados de cuenta" }).click();
  const cutOff = page.locator("section").filter({ has: page.getByRole("heading", { name: "Facturas al corte" }) });
  await expect(cutOff).toContainText(invoice.fiscalNumber);
  await snap(page, "fase4-finanzas-estado-de-cuenta");

  // 4-A, 4-N20: six reports; «Ventas (e-CF simulado)» is the sales book of the simulated e-CF.
  await navigation.getByRole("button", { name: /^Reportes/ }).first().click();
  const reports = page.getByRole("tablist", { name: "Reportes" });
  await expect(reports.getByRole("tab")).toHaveText(["Ingresos por período", "Cuentas por cobrar y antigüedad", "Cobranza",
    "Cuentas por pagar", "Recargos", "Ventas (e-CF simulado)"]);
  await reports.getByRole("tab", { name: "Ventas (e-CF simulado)" }).click();
  await page.getByLabel("Desde").fill(issuedDay);
  await expect(page.getByRole("table")).toContainText(invoice.fiscalNumber);
  await expect(page.getByText(/Simulación — sin validez fiscal/).first()).toBeVisible();
  await snap(page, "fase4-finanzas-reporte-ventas");

  // 4-N12: the legacy writes answer 410 with their code, whatever the permissions; the retired routes are gone.
  const legacy: Array<[string, Record<string, unknown>]> = [
    ["/finance/invoices", { preinvoiceId: randomUUID(), requestId: randomUUID() }],
    [`/finance/invoices/${randomUUID()}/credit-notes`, { amount: 1, reason: "Ruta retirada (ciclo E2E)" }],
    ["/finance/payments", { invoiceId: randomUUID(), amount: 1, reference: "E2E-410", method: "Transfer" }],
  ];
  for (const [route, body] of legacy) {
    const refused = await expectCall<{ code?: string }>(410, token, "POST", route, body);
    expect(refused.data.code, route).toBe("legacy_finance_route_retired");
  }
  for (const route of ["/finance/preinvoices", "/finance/approved-services", "/finance/reconciliation",
    "/finance/tax-policies", "/finance/fiscal-documents"])
    await expectCall(404, token, "GET", route);
  // 4-A: the permission matrix offers the simplified Finance; the retired codes only resolve as aliases.
  const catalog = await expectCall<Array<{ department: string; modules: Array<{ key: string; section: string;
    actions: Array<{ code: string }> }> }>>(200, token, "GET", "/governance/catalog");
  const financeCatalog = catalog.data.find(item => item.department === "finance");
  expect(financeCatalog, "the Finance catalog").toBeTruthy();
  const keys = financeCatalog!.modules.map(module => module.key);
  for (const retired of ["preinvoices", "approved_services", "taxes", "fiscal"]) expect(keys).not.toContain(retired);
  expect([...new Set(financeCatalog!.modules.map(module => module.section))])
    .toEqual(["Inicio", "Facturación", "Cuentas por pagar", "Reportes", "Configuración"]);
  expect(financeCatalog!.modules.flatMap(module => module.actions.map(action => action.code)))
    .not.toContain("finance.reconciliation.create");
});

// Block D: Cuentas por pagar y gastos. Every code, NCF and concept carries the run id and an attempt suffix, so a resumed
// run never collides with an earlier attempt. The seeded Finance account registers and submits, so it never approves
// nor pays its own invoice (4-N14).
const RECEIPT_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Opens a child of «Cuentas por pagar»; the group is a disclosure, so it is expanded only while it is closed. */
async function openPayables(page: Page, label: string, heading = label) {
  const navigation = page.getByRole("navigation", { name: "Navegación principal" });
  const group = navigation.getByRole("button", { name: /^Cuentas por pagar/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  await navigation.getByRole("button", { name: label, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

type PayableRow = { id: string; status: string; version: string };
const attemptTag = (runId: string) => `${runId}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("Cuentas por pagar: corregir, anular y volver a usar el NCF, segregación y retiro del proveedor (4-N03, 4-N14, 4-N15)", async ({ page }) => {
  const tag = attemptTag(loadRun().runId);
  const code = `E2E-${tag}`;
  const name = `Proveedor del ciclo ${tag}`;
  const ncf = `NCF-${tag}`;
  const token = await login("finance");
  await loginPrivate(page, "finance");

  await openPayables(page, "Proveedores");
  await page.getByRole("button", { name: "Nuevo proveedor" }).click();
  await page.getByLabel("Código", { exact: true }).fill(code);
  await page.getByLabel("Nombre del proveedor").fill(name);
  await page.getByRole("button", { name: "Guardar proveedor" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await snap(page, "fase4-cxp-proveedor");

  await openPayables(page, "Facturas de proveedores", "Cuentas por pagar");
  const registerInvoice = async () => {
    await page.getByRole("button", { name: "Nueva factura de proveedor" }).click();
    const form = page.getByRole("form", { name: "Borrador de factura de proveedor" });
    await form.getByLabel("Proveedor", { exact: true }).selectOption({ label: `${code} · ${name}` });
    await form.getByLabel("Referencia del proveedor").fill(ncf);
    await form.getByLabel("Descripción de línea 1").fill("Limpieza de rampa");
    await form.getByLabel("Precio unitario de línea 1").fill("1500");
    await form.getByLabel("Tasa a DOP").fill("60");
    await form.getByLabel("Fuente de la tasa").fill("Tasa revisada del ciclo E2E");
    await form.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(form).toBeHidden();
  };
  const invoiceRow = (status: string) => page.getByRole("row").filter({ hasText: status })
    .getByRole("button", { name: new RegExp(ncf) });
  const detail = page.getByRole("region", { name: "Detalle de cuenta por pagar" });
  const decide = async (action: string, confirm: string, reason?: string) => {
    await detail.getByRole("button", { name: action }).click();
    if (reason) await detail.getByLabel("Motivo de la decisión").fill(reason);
    await detail.getByRole("button", { name: confirm }).click();
  };
  await registerInvoice();
  await invoiceRow("Borrador").click();
  await decide("Enviar a revisión", "Confirmar envío");
  await expect(detail.getByText("En revisión de Finanzas", { exact: true })).toBeVisible();
  // 4-N14: who submitted it does not approve it; the screen says so and the API refuses it by person.
  await expect(detail.getByRole("button", { name: "Aprobar factura" })).toHaveCount(0);
  await expect(detail.getByText("Otra persona de Finanzas debe aprobar esta factura.")).toBeVisible();
  const listed = await expectCall<PayableRow[]>(200, token, "GET", `/finance/payables?search=${encodeURIComponent(ncf)}&take=25`);
  const submitted = listed.data.find(item => item.status === "Submitted");
  expect(submitted, "the submitted invoice of the run").toBeTruthy();
  const refused = await expectCall<{ code?: string }>(403, token, "POST", `/finance/payables/${submitted!.id}/decisions`,
    { requestId: randomUUID(), expectedVersion: submitted!.version, decision: "Approved" });
  expect(refused.data.code).toBe("segregation_of_duties");
  await snap(page, "fase4-cxp-segregacion");

  // 4-N03: its creator still rejects it; the rejected invoice returns to Draft and is voided, each with its reason.
  await decide("Rechazar factura", "Confirmar decisión", "Referencia digitada con error");
  await expect(detail.getByText("Rechazado", { exact: true })).toBeVisible();
  await decide("Corregir factura", "Confirmar corrección", "Se corrige la referencia del proveedor");
  await expect(detail.getByText("Borrador", { exact: true })).toBeVisible();
  await decide("Anular borrador", "Confirmar anulación", "Factura registrada con datos erróneos");
  await expect(detail.getByText("Anulada", { exact: true })).toBeVisible();
  await snap(page, "fase4-cxp-factura-anulada");
  // The voided invoice freed its NCF: the corrected one is registered again with the real number.
  await registerInvoice();
  await expect(invoiceRow("Borrador")).toBeVisible();
  const both = await expectCall<PayableRow[]>(200, token, "GET", `/finance/payables?search=${encodeURIComponent(ncf)}&take=25`);
  expect(both.data.map(item => item.status).sort()).toEqual(["Draft", "Voided"]);

  // 4-N15: the open draft keeps the supplier working; once it is voided the supplier retires with its history.
  await openPayables(page, "Proveedores");
  await page.getByRole("button", { name, exact: true }).click();
  const supplier = page.getByRole("region", { name: "Detalle del proveedor" });
  await supplier.getByRole("button", { name: "Retirar proveedor" }).click();
  await supplier.getByLabel("Motivo del retiro").fill("Proveedor sin contrato vigente");
  await supplier.getByRole("button", { name: "Confirmar retiro" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "El proveedor tiene facturas en curso" })).toBeVisible();
  await snap(page, "fase4-cxp-retiro-rechazado");
  const draft = both.data.find(item => item.status === "Draft")!;
  await expectCall(200, token, "POST", `/finance/payables/${draft.id}/decisions`,
    { requestId: randomUUID(), expectedVersion: draft.version, decision: "Voided", reason: "Borrador de prueba del ciclo" });
  await supplier.getByRole("button", { name: "Confirmar retiro" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toContainText("Inactivo");
  await snap(page, "fase4-cxp-proveedor-retirado");
});

test("Gastos: el gasto de OCC se revisa por escalamiento en Finanzas y «Mis gastos» de Finanzas descarta un borrador (4-N13, 4-N28)", async ({ page }) => {
  const tag = attemptTag(loadRun().runId);
  const concept = `Combustible de rampa ${tag}`;
  const own = `Taxi de Finanzas ${tag}`;
  const receipt = { name: "recibo.png", mimeType: "image/png", buffer: Buffer.from(RECEIPT_PNG, "base64") };
  const detail = page.getByRole("region", { name: "Detalle de gasto" });
  const fileExpense = async (description: string) => {
    await page.getByRole("button", { name: "Nuevo gasto" }).click();
    const form = page.getByRole("form", { name: "Borrador de gasto" });
    await form.getByLabel("Concepto del gasto").fill(description);
    await form.getByLabel("Descripción de línea 1").fill("Combustible y peaje");
    await form.getByLabel("Precio unitario de línea 1").fill("45");
    await form.getByLabel("Tasa a DOP").fill("60");
    await form.getByLabel("Fuente de la tasa").fill("Tasa revisada del ciclo E2E");
    await form.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(form).toBeHidden();
    await page.getByRole("button", { name: new RegExp(description) }).click();
    await expect(detail).toBeVisible();
  };
  const upload = async () => {
    await detail.getByLabel("Adjuntar comprobante privado").setInputFiles(receipt);
    await detail.getByRole("button", { name: "Subir comprobante" }).click();
    await expect(detail.getByRole("button", { name: /Descargar comprobante 1/ })).toBeVisible();
  };

  // OCC's only administrator files its expense; a receipt uploaded by mistake is removed before submitting it.
  await loginPrivate(page, "occ");
  await goPrivate(page, "/admin-occ/expenses");
  await expect(page.getByRole("heading", { level: 1, name: "Mis gastos" })).toBeVisible();
  await fileExpense(concept);
  await upload();
  await detail.getByRole("button", { name: "Quitar comprobante 1" }).click();
  await detail.getByRole("button", { name: "Sí, quitar el comprobante" }).click();
  await expect(detail.getByText("Sin comprobantes adjuntos.")).toBeVisible();
  await snap(page, "fase4-gastos-comprobante-quitado");
  await upload();
  await detail.getByRole("button", { name: "Enviar gasto al departamento" }).click();
  await detail.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(detail.getByText("En revisión de departamento", { exact: true })).toBeVisible();
  await expect(detail.getByText("Sin otro administrador de su departamento en la estación: lo revisa Finanzas.")).toBeVisible();
  await snap(page, "fase4-gastos-occ-enviado");
  const occ = await login("occ");
  const filed = await expectCall<Array<{ id: string; reviewRoute: string | null; receipts: unknown[] }>>(200, occ, "GET",
    `/finance/expenses?search=${encodeURIComponent(concept)}&ownOnly=true&take=25`);
  expect(filed.data.map(item => [item.reviewRoute, item.receipts.length])).toEqual([["Finance", 1]]);

  // A Finance administrator reviews it by escalation; the final approval is left to another person of Finance.
  await loginPrivate(page, "finance");
  await openPayables(page, "Gastos de empleados");
  await page.getByLabel("Buscar", { exact: true }).fill(concept);
  await page.getByRole("button", { name: new RegExp(concept) }).click();
  await expect(detail.getByText("Revisión por escalamiento: el departamento del gasto no tiene otro administrador en la estación.")).toBeVisible();
  await snap(page, "fase4-gastos-escalamiento");
  await detail.getByRole("button", { name: "Aprobar por escalamiento" }).click();
  await detail.getByRole("button", { name: "Confirmar decisión" }).click();
  await expect(detail.getByText("Pendiente de Finanzas", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Aprobar Finanzas" })).toHaveCount(0);
  await expect(detail.getByText("Usted revisó este gasto: otra persona de Finanzas debe darle la aprobación final.")).toBeVisible();
  const finance = await login("finance");
  const escalated = await expectCall<{ status: string; version: string; reviews: Array<{ stage: string }> }>(200, finance, "GET",
    `/finance/expenses/${filed.data[0].id}`);
  expect([escalated.data.status, escalated.data.reviews[escalated.data.reviews.length - 1]?.stage]).toEqual(["DepartmentApproved", "Escalation"]);
  const self = await expectCall<{ code?: string }>(403, finance, "POST", `/finance/expenses/${filed.data[0].id}/decisions`,
    { requestId: randomUUID(), expectedVersion: escalated.data.version, decision: "Approved" });
  expect(self.data.code).toBe("segregation_of_duties");

  // 4-N28: «Mis gastos» needs no Finance code; a draft filed by mistake is discarded with its reason.
  await openPayables(page, "Mis gastos");
  await fileExpense(own);
  await detail.getByRole("button", { name: "Descartar borrador" }).click();
  await detail.getByLabel("Motivo de la decisión").fill("Gasto registrado por error");
  await detail.getByRole("button", { name: "Confirmar descarte" }).click();
  await expect(detail.getByText("Descartado", { exact: true })).toBeVisible();
  await snap(page, "fase4-gastos-descartado");
});

test.fixme("hueco 4-B · el Vault describe el ciclo completo tal como funciona", async () => {});
