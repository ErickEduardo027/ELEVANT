import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hubEvents = vi.hoisted(() => ({ catalogChanged: null as (() => void) | null }));

vi.mock("@microsoft/signalr", () => ({
  HubConnectionState: { Disconnected: "Disconnected" },
  HubConnectionBuilder: class {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    build() { return { state: "Disconnected", on: (name: string, handler: () => void) => {
      if (name === "CatalogChangedV1") hubEvents.catalogChanged = handler;
    }, onreconnected: () => {},
      start: async () => {}, stop: async () => {} }; }
  },
}));

const serviceId = "20000000-0000-7000-8000-000000000006";
const airlineId = "20000000-0000-7000-8000-000000000003";
const catalog = {
  services: [{ id: serviceId, name: "Baggage handling", description: "Ramp service",
    imageUrl: null, videoUrl: null, displayOrder: 1 }],
  airlines: [{ id: airlineId, name: "Synthetic Airways", region: "Caribbean",
    legalName: null, countryCode: null, iataCode: null, icaoCode: null,
    logoUrl: null, isVerified: false }],
};

afterEach(() => {
  cleanup(); hubEvents.catalogChanged = null; vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

async function fillApplication() {
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  fireEvent.change(screen.getByRole("combobox", { name: /Seleccione una aerolínea/i }),
    { target: { value: airlineId } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre completo" }),
    { target: { value: "Alex Test" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Cargo" }),
    { target: { value: "Operations Manager" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Correo corporativo" }),
    { target: { value: "alex@synthetic.example.test" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Teléfono" }),
    { target: { value: "+1 809 555 0100" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Declaro que estoy autorizado/i }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
}

it("shows a full confirmation step before sending the application", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  let posts = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog"))
      return new Response(JSON.stringify(catalog),
        { headers: { "content-type": "application/json" } });
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts += 1;
      return new Response(JSON.stringify({ reference: "REQ-1", replayed: false }),
        { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  expect(screen.getByText(/PASO 04 \/ 04/i)).toBeInTheDocument();
  expect(screen.getByText("Baggage handling")).toBeInTheDocument();
  expect(screen.getByText("Synthetic Airways")).toBeInTheDocument();
  expect(screen.getByText(/alex@synthetic\.example\.test/)).toBeInTheDocument();
  expect(posts).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await screen.findByText("REQ-1");
  expect(posts).toBe(1);
});

it("rejects a catalog with an unexpected private field", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    ...catalog, airlines: [{ ...catalog.airlines[0], passwordHash: "synthetic" }],
  }), { headers: { "content-type": "application/json" } })));

  render(<AccessRequestWizard />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Añadir servicio +" })).not.toBeInTheDocument();
});

it("verifies an uncertain submission without creating another request or trusting a malformed receipt", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const posts: Array<Record<string, unknown>> = [];
  const lookups: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog"))
      return new Response(JSON.stringify(catalog),
        { headers: { "content-type": "application/json" } });
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      throw new TypeError("synthetic connection reset");
    }
    if (String(url).endsWith("commercial-requests/receipt") && init?.method === "POST") {
      lookups.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (lookups.length === 1) return new Response(JSON.stringify({
        reference: "REQ-SYNTHETIC-001", replayed: false, accountActivated: true,
      }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ reference: "REQ-SYNTHETIC-001",
        replayed: true }),
      { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await waitFor(() => expect(posts).toHaveLength(1));
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: /Reintentar catálogo/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await waitFor(() => expect(lookups).toHaveLength(1));
  expect(screen.queryByText("REQ-SYNTHETIC-001")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await screen.findByText("REQ-SYNTHETIC-001");
  expect(posts).toHaveLength(1);
  expect(lookups).toEqual([posts[0], posts[0]]);
  expect(posts[0].serviceIds).toEqual([serviceId]);
  expect(posts[0].airlineProfileId).toBe(airlineId);
});

it("keeps a completed application usable after a transient catalog refresh failure", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  let catalogReads = 0;
  let posts = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog")) {
      catalogReads += 1;
      if (catalogReads > 1) throw new TypeError("synthetic transient outage");
      return new Response(JSON.stringify(catalog),
        { headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts += 1;
      return new Response(JSON.stringify({ reference: "REQ-SYNTHETIC-002", replayed: false }),
        { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  expect(hubEvents.catalogChanged).toBeTypeOf("function");
  await act(async () => { hubEvents.catalogChanged?.(); });
  expect(catalogReads).toBe(2);
  expect(await screen.findByRole("alert")).toHaveTextContent(/catálogo/i);
  expect(screen.getByRole("button", { name: /Reintentar catálogo/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await screen.findByText("REQ-SYNTHETIC-002");
  expect(posts).toBe(1);
});

it("returns to service selection when a chosen service is withdrawn, preserving airline and representative", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  let reads = 0;
  const replacementId = "20000000-0000-7000-8000-000000000007";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url) => {
    if (!String(url).endsWith("commercial-catalog")) throw new Error(`Unexpected request: ${url}`);
    reads += 1;
    return new Response(JSON.stringify(reads === 1 ? catalog : {
      ...catalog, services: [{ ...catalog.services[0], id: replacementId, name: "Ground power" }],
    }), { headers: { "content-type": "application/json" } });
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  expect(screen.getByText(/PASO 04 \/ 04/i)).toBeInTheDocument();
  await act(async () => { hubEvents.catalogChanged?.(); });
  expect(await screen.findByRole("alert")).toHaveTextContent(/dejó de estar disponible/i);
  expect(screen.getByRole("alert")).toHaveTextContent("Baggage handling");
  expect(screen.getByText(/PASO 01 \/ 04/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Enviar solicitud/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByRole("combobox", { name: /Seleccione una aero/i })).toHaveValue(airlineId);
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByRole("textbox", { name: "Nombre completo" })).toHaveValue("Alex Test");
});

it("recovers an accepted receipt with the original id after a withdrawn service", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const posts: Array<Record<string, unknown>> = [];
  const lookups: Array<Record<string, unknown>> = [];
  let catalogReads = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog")) {
      catalogReads += 1;
      return new Response(JSON.stringify(catalogReads === 1 ? catalog :
        { ...catalog, services: [] }),
      { headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      throw new TypeError("response lost after commit");
    }
    if (String(url).endsWith("commercial-requests/receipt") && init?.method === "POST") {
      lookups.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ reference: "REQ-RECOVERED", replayed: true }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await waitFor(() => expect(posts).toHaveLength(1));
  await screen.findByRole("alert");
  await act(async () => { hubEvents.catalogChanged?.(); });
  await screen.findByText("REQ-RECOVERED");
  expect(posts).toHaveLength(1);
  expect(lookups).toEqual(posts);
});

it("never creates a request after withdrawal when the first submission did not commit", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  let catalogReads = 0;
  let posts = 0;
  let lookups = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog")) {
      catalogReads += 1;
      return new Response(JSON.stringify(catalogReads === 2 ?
        { ...catalog, services: [] } : catalog),
      { headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts += 1;
      throw new TypeError("failed before commit");
    }
    if (String(url).endsWith("commercial-requests/receipt") && init?.method === "POST") {
      lookups += 1;
      return new Response(JSON.stringify({ title: "Receipt not found" }),
        { status: 404, headers: { "content-type": "application/problem+json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await screen.findByRole("alert");
  await act(async () => { hubEvents.catalogChanged?.(); });
  await waitFor(() => expect(lookups).toBe(1));
  await act(async () => { hubEvents.catalogChanged?.(); });
  expect(catalogReads).toBe(3);
  expect(posts).toBe(1);
  expect(screen.queryByText("REQ-RECOVERED")).not.toBeInTheDocument();
  expect(screen.getByText(/PASO 01 \/ 04/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Continuar/i })).toBeInTheDocument();
});

it("reloads a withdrawn service immediately when the submit returns conflict", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  let catalogReads = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog")) {
      catalogReads += 1;
      return new Response(JSON.stringify(catalogReads === 1 ? catalog :
        { ...catalog, services: [] }),
      { headers: { "content-type": "application/json" } });
    }
    if (String(url).endsWith("commercial-requests") && init?.method === "POST")
      return new Response(JSON.stringify({ title: "Service unavailable" }),
        { status: 409, headers: { "content-type": "application/problem+json" } });
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Baggage handling");
  expect(screen.getByText(/PASO 01 \/ 04/i)).toBeInTheDocument();
  expect(catalogReads).toBe(2);
});
