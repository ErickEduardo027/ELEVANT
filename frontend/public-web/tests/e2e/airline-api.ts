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

export async function stubAirlineApi(page: Page, options: { forbidden?: boolean; changeRequired?: boolean } = {}) {
  const paths: string[] = [];
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
    } else await route.fulfill({ status: 404, headers, body: JSON.stringify({ status: 404 }) });
  });
  return paths;
}
