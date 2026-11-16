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
