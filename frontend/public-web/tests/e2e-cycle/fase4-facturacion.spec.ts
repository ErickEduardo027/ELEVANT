import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { call, login } from "./support/api";
import { loginPortal, loginPrivate, snap } from "./support/browser";
import { API, loadRun, saveRun } from "./support/env";
import { pdfText } from "./support/pdf";

// Fase 4 · Facturación: Finanzas invoices the run's approved operation (simulated e-CF), the airline
// pays it by card in its portal (a declined card first, then an approved one, against the simulated
// gateway) and gets the receipt, and Finanzas sees the card payment. The card numbers are the public
// test numbers of the simulated gateway; no screenshot is taken while they are typed.

const DECLINED = "4000 0000 0000 0002";
const APPROVED = "4111 1111 1111 1111";
const localDay = () => new Date().toLocaleDateString("en-CA");
// 4-N10: Finance dates by the business day of Santo Domingo, whatever the zone of the machine or UTC.
const businessDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric",
  month: "2-digit", day: "2-digit" }).format(new Date());

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

test("Finanzas consulta sus reportes del período", async ({ page }) => {
  await loginPrivate(page, "finance");
  await page.getByRole("navigation").getByRole("button", { name: /^Reportes/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await snap(page, "fase4-finanzas-reportes");
});

test.fixme("hueco 4-A · Finanzas sin prefacturas: menú Inicio · Facturación · Cuentas por pagar · Reportes · Configuración · Usuarios", async () => {});
test.fixme("hueco 4-B · el Vault describe el ciclo completo tal como funciona", async () => {});
