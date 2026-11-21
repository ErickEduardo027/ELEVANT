import type { Page } from "@playwright/test";

const actor = {
  accountId: "40000000-0000-7000-8000-000000000003",
  email: "airline.client@dev.elevant.test", displayName: "Casey Airline",
  roles: [{ roleId: "41000000-0000-7000-8000-000000000003", code: "AIRLINE_CLIENT",
    name: "Airline Client", portal: "airline_portal", userType: "airline_client" }],
  memberships: [{ membershipId: "42000000-0000-7000-8000-000000000003",
    organizationId: "10000000-0000-7000-8000-000000000002", organizationCode: "DEMO-AIR",
    organizationName: "Demo Airlines", organizationType: "airline_customer", kind: "airline_client" }],
  stationScopes: [],
};

const bootstrap = {
  airlineId: "20000000-0000-7000-8000-000000000001",
  organizationId: actor.memberships[0].organizationId,
  iataCode: "ZZ", icaoCode: "DVA", name: "Demo Airlines",
  stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ",
    name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }],
  currentOperations: [{ id: "30000000-0000-7000-8000-000000000003", code: "DEV-TAT-0002",
    stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ",
    operationDate: "2026-09-25", status: "in_progress", arrivalFlightNumber: "ZZ101" }],
};

const contracts = {
  page: 1, limit: 20, hasMore: false,
  contracts: [{ id: "60000000-0000-7000-8000-000000000002",
    code: "DEV-CONTRACT-0001", status: "Active", signedOn: "2026-01-01",
    terminatedOn: null, approvedVersions: [{
      id: "60000000-0000-7000-8000-000000000003", versionNumber: 1,
      validFrom: "2026-01-01", validTo: "2099-12-31", currencyCode: "USD",
      stations: [{ id: "20000000-0000-7000-8000-000000000003", code: "PUJ", name: "Punta Cana" }],
      rates: [{ id: "60000000-0000-7000-8000-000000000004", serviceCode: "BAG",
        serviceName: "Manejo de equipaje", billingUnit: "operation", unitPrice: 125.5,
        minimumQuantity: 1 }],
    }],
  }],
};

const operation = { id: "30000000-0000-7000-8000-000000000003", code: "DEV-TAT-0002",
  stationId: "20000000-0000-7000-8000-000000000003", stationCode: "PUJ", operationDate: "2026-09-25",
  status: "InProgress", arrivalFlightNumber: "ZZ101", departureFlightNumber: null, plannedStartAt: null, plannedEndAt: null };

const challenge = { challengeId: "7a000000-0000-7000-8000-000000000001", emailHint: "a••••t@dev.elevant.test",
  expiresAt: "2099-01-01T00:10:00Z", code: "code_required" };

export const E2E_LOGIN_CODE = "246810";

const versionId = "60000000-0000-7000-8000-000000000003";
const document = { contractId: "60000000-0000-7000-8000-000000000002", versionId, contractCode: "DEV-CONTRACT-0001",
  contractStatus: "Active", airlineName: "Demo Airlines", airlineCode: "ZZ", airlineLegalName: null, versionNumber: 1,
  versionStatus: "Approved", validFrom: "2026-01-01", validTo: "2099-12-31", currencyCode: "USD", stations: ["PUJ · Punta Cana"],
  rates: [], terms: null, signedOn: "2026-01-01", signatures: [], contentSha256: "a".repeat(64), signableBy: null };
/** N18: the same version once Contratos fixed its validity, waiting for the airline's signature. */
export const signableContract = { versionId, document: { ...document, signedOn: null, signableBy: "Airline",
  validity: { renewalMode: "Automatic", renewalTermMonths: 12, renewalNoticeDays: 30, terminationNoticeDays: 60,
    terminationTerms: null, confirmedAt: "2026-11-03T12:00:00Z" } } };
const timeline = { contractId: document.contractId, contractCode: "DEV-CONTRACT-0001", status: "Active", entries: [
  { at: "2026-01-01T12:00:00Z", kind: "status", title: "Contrato activo", detail: "Aprobado por Finanzas, firmado por ambas partes.", actor: null }] };
const permit = { id: "63000000-0000-7000-8000-000000000001", airlineId: "20000000-0000-7000-8000-000000000001",
  airline: "Demo Airlines", kind: "OperatingPermit", number: "", issuer: "", issuedOn: "2026-10-01", expiresOn: "2099-01-01",
  validity: "Current", review: "Submitted", reviewNote: null, documentUrl: null, submittedAt: "2026-11-02T12:00:00.000Z",
  reviewedAt: null, version: "AAAAAAAAB9E=" };

export async function stubAirlineApi(page: Page, options: { forbidden?: boolean; changeRequired?: boolean; codeRequired?: boolean } = {}) {
  const paths: string[] = [];
  const permits: object[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "authorization,content-type",
      } });
      return;
    }
    paths.push(`${request.method()} ${path}`);
    const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
    if (path === "/api/v1/auth/password-change") {
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    } else if (path === "/api/v1/auth/session" && request.method() === "POST" && options.codeRequired) {
      await route.fulfill({ status: 202, headers, body: JSON.stringify(challenge) });
    } else if (path === "/api/v1/auth/session/verify-code") {
      const body = request.postDataJSON() as { code?: string };
      await route.fulfill(body.code === E2E_LOGIN_CODE
        ? { status: 200, headers, body: JSON.stringify({ accessToken: "synthetic-e2e-token", tokenType: "Bearer",
          expiresAt: "2099-01-01T00:00:00Z", actor }) }
        : { status: 401, headers, body: JSON.stringify({ status: 401, title: "Authentication failed." }) });
    } else if (path === "/api/v1/auth/session/resend-code") {
      await route.fulfill({ status: 202, headers, body: JSON.stringify(challenge) });
    } else if (path === "/api/v1/auth/session" && request.method() === "POST") {
      if (options.changeRequired) await route.fulfill({ status: 409, headers,
        body: JSON.stringify({ status: 409, code: "password_change_required" }) });
      else await route.fulfill({ status: 200, headers, body: JSON.stringify({
        accessToken: "synthetic-e2e-token", tokenType: "Bearer", expiresAt: "2099-01-01T00:00:00Z",
        actor: options.forbidden ? { ...actor, roles: [{ ...actor.roles[0], code: "ADMIN_OCC", portal: "back_office", userType: "internal_staff" }] } : actor,
      }) });
    } else if (path === "/api/v1/auth/session") {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ actor }) });
    } else if (path === "/api/v1/airline/portal/bootstrap") {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(bootstrap) });
    } else if (path === "/api/v1/airline/portal/contracts") {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(contracts) });
    } else if (path === "/api/v1/airline/portal/operations") {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ page: 1, limit: 20, hasMore: false, operations: [operation] }) });
    } else if (path === `/api/v1/airline/portal/operations/${operation.id}`) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(operation) });
    } else if (path === "/api/v1/auth/password-reset") {
      await route.fulfill({ status: 202, headers: { "access-control-allow-origin": "*" } });
    } else if (path === "/api/v1/auth/password-reset/confirm" || path === "/api/v1/auth/account/activate") {
      const body = request.postDataJSON() as { newPassword?: string };
      await route.fulfill((body.newPassword?.length ?? 0) >= 14
        ? { status: 204, headers: { "access-control-allow-origin": "*" } }
        : { status: 400, headers, body: JSON.stringify({ status: 400, code: "password_policy" }) });
    } else if (path === "/api/v1/airline/contract-drafts") {
      await route.fulfill({ status: 200, headers, body: "[]" });
    } else if (path === "/api/v1/airline/permits") {
      if (request.method() === "POST") {
        permits.push({ ...permit, ...(request.postDataJSON() as object), documentUrl: null });
        await route.fulfill({ status: 201, headers, body: JSON.stringify(permits.at(-1)) });
      } else await route.fulfill({ status: 200, headers, body: JSON.stringify(permits) });
    } else if (path === `/api/v1/contract-versions/${versionId}/document`) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(document) });
    } else if (path === `/api/v1/contract-versions/${versionId}/document/pdf`) {
      await route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "access-control-allow-origin": "*" },
        body: Buffer.from("%PDF-1.7 e2e fixture") });
    } else if (path === `/api/v1/contract-versions/${versionId}/timeline`) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify(timeline) });
    } else if (path === "/api/v1/changes") {
      await route.fulfill({ status: 200, headers,
        body: JSON.stringify({ changes: [], nextCursor: null, hasMore: false }) });
    } else {
      // Any other read is reported as temporarily unavailable, not as a missing tenant.
      await route.fulfill({ status: 503, headers, body: JSON.stringify({ status: 503, title: "Unavailable" }) });
    }
  });
  return paths;
}

const puj = bootstrap.stations[0].id;
const financeInvoice = (id: string, fiscalNumber: string, total: number, paid: number, dueDate: string, daysOverdue: number) => ({
  id, preinvoiceId: `74100000-0000-7000-8000-00000000000${id.slice(-1)}`, number: `NF-${id.slice(-4)}`, fiscalNumber,
  stationId: puj, stationCode: "PUJ", currencyCode: "USD", total, legacyPaid: 0, legacyCredited: 0, applied: paid, credited: 0,
  debited: 0, balance: Math.round((total - paid) * 100) / 100, dueDate, daysOverdue,
  agingBucket: daysOverdue === 0 ? "Current" : daysOverdue <= 30 ? "1-30" : "31-60" });
/** PR F: four invoices of the synthetic airline (pending, paid, partly paid and overdue) and one bank receipt. */
export const financeInvoices = [
  financeInvoice("74000000-0000-7000-8000-000000000001", "E310000000101", 1480.9, 0, "2026-12-05", 0),
  financeInvoice("74000000-0000-7000-8000-000000000002", "E310000000102", 2360, 2360, "2026-11-10", 0),
  financeInvoice("74000000-0000-7000-8000-000000000003", "E310000000103", 845.5, 300, "2026-11-01", 20),
  financeInvoice("74000000-0000-7000-8000-000000000004", "E310000000104", 12500, 0, "2026-10-05", 47),
];
const receiptId = "75000000-0000-7000-8000-000000000001";
const financeMovements = [
  ...financeInvoices.map((item, index) => ({ id: `76000000-0000-7000-8000-00000000000${index}`, receiptId: null,
    invoiceId: item.id, kind: "Invoice", currencyCode: "USD", amount: item.total,
    effectiveOn: ["2026-11-05", "2026-10-11", "2026-10-02", "2026-09-05"][index], recordedAt: "2026-11-05T12:00:00Z",
    reversesId: null, reference: item.fiscalNumber })),
  { id: receiptId, receiptId, invoiceId: null, kind: "Receipt", currencyCode: "USD", amount: 3000, effectiveOn: "2026-11-09",
    recordedAt: "2026-11-09T12:00:00Z", reversesId: null, reference: "BANK-2026-1109" },
  { id: "77000000-0000-7000-8000-000000000001", receiptId, invoiceId: financeInvoices[1].id, kind: "Application",
    currencyCode: "USD", amount: 2360, effectiveOn: "2026-11-09", recordedAt: "2026-11-09T12:01:00Z", reversesId: null, reference: "" },
  { id: "77000000-0000-7000-8000-000000000002", receiptId, invoiceId: financeInvoices[2].id, kind: "Application",
    currencyCode: "USD", amount: 300, effectiveOn: "2026-11-09", recordedAt: "2026-11-09T12:02:00Z", reversesId: null, reference: "" },
].sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn));
const financeReceipt = { id: receiptId, stationId: puj, stationCode: "PUJ", reference: "BANK-2026-1109", currencyCode: "USD",
  amount: 3000, applied: 2660, refunded: 0, available: 340, reversed: false, method: "Transfer", receivedOn: "2026-11-09", movements: [
    { id: "77000000-0000-7000-8000-000000000001", kind: "Application", invoiceId: financeInvoices[1].id, reversesId: null,
      effectiveOn: "2026-11-09", receiptAmount: 2360, invoiceAmount: 2360, receiptCurrency: "USD", invoiceCurrency: "USD",
      exchangeRate: 1, exchangeRateOn: "2026-11-09", reference: "", reason: "Pago de factura", recordedAt: "2026-11-09T12:01:00Z" }] };
const financeStatement = { airlineId: bootstrap.airlineId, asOf: "2026-11-21", invoices: financeInvoices, receipts: [financeReceipt],
  movements: financeMovements, aging: [{ currencyCode: "USD", balance: 14526.4, current: 1480.9, days1To30: 545.5,
    days31To60: 12500, days61To90: 0, days91Plus: 0, unallocated: 340, creditBalance: 0 }] };
const financeLine = (id: number, kind: string, parent: number | null, serviceCode: string, serviceName: string, quantity: number,
  billingUnit: string, unitPrice: number, amount: number, reason: string | null = null) => ({
  id: `78000000-0000-7000-8000-00000000000${id}`, lineNumber: id, kind, parentLineNumber: parent, operationCode: "DEV-TAT-0021",
  operationDate: "2026-11-04", serviceCode, serviceName, quantity, billingUnit, unitPrice, amount, reason });
const invoiceDetail = (invoice: typeof financeInvoices[number]) => ({ invoice,
  movements: financeMovements.filter(item => item.invoiceId === invoice.id), notes: [], lines: [
    financeLine(1, "Service", null, "GPU", "Planta eléctrica (GPU)", 2, "hour", 300, 708),
    financeLine(2, "Service", null, "BAG", "Manejo de equipaje", 1, "operation", 550, 649),
    financeLine(3, "Charge", 1, "NIGHT", "Recargo nocturno", 1, "operation", 105, 123.9, "Servicio entre 22:00 y 06:00")] });

/** Serves the portal's treasury and card payment reads with the synthetic invoices above. */
export async function stubAirlineFinance(page: Page) {
  const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
  await page.route("**/api/v1/airline/portal/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") { await route.fallback(); return; }
    const path = new URL(request.url()).pathname;
    const invoiceId = /\/(?:treasury\/invoices|invoices)\/([^/]+)/.exec(path)?.[1];
    const invoice = financeInvoices.find(item => item.id === invoiceId);
    const body = path.endsWith("/treasury/statements") ? financeStatement
      : path.includes("/treasury/invoices/") ? invoice ? invoiceDetail(invoice) : undefined
      : path.includes("/treasury/receipts/") ? financeReceipt
      : path.endsWith("/card-payments/availability") ? { available: true, simulated: true }
      : path.endsWith("/card-payments") && invoice ? { invoiceId: invoice.id, attempts: [{
        id: "79000000-0000-7000-8000-000000000001", invoiceId: invoice.id, status: "Declined", brand: "Visa", last4: "0002",
        amount: invoice.balance || 1, currencyCode: "USD", authorizationCode: null, declineCode: "insufficient_funds",
        receiptId: null, attemptedAt: "2026-11-20T15:30:00Z" }] }
      : null;
    if (body === null) { await route.fallback(); return; }
    if (body === undefined) {
      await route.fulfill({ status: 404, headers, body: JSON.stringify({ status: 404, title: "Not Found" }) });
      return;
    }
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}