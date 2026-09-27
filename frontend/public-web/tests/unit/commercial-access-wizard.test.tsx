import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@microsoft/signalr", () => ({
  HubConnectionState: { Disconnected: "Disconnected" },
  HubConnectionBuilder: class {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    build() { return { state: "Disconnected", on: () => {}, onreconnected: () => {},
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
  cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
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
}

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

it("retries with one request id but never treats a malformed receipt as approval", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog"))
      return new Response(JSON.stringify(catalog),
        { headers: { "content-type": "application/json" } });
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      if (posts.length === 1) throw new TypeError("synthetic connection reset");
      if (posts.length === 2) return new Response(JSON.stringify({
        reference: "REQ-SYNTHETIC-001", replayed: false, accountActivated: true,
      }), { status: 201, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ reference: "REQ-SYNTHETIC-001",
        replayed: false }),
      { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<AccessRequestWizard />);
  await fillApplication();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await waitFor(() => expect(posts).toHaveLength(1));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(screen.queryByText("REQ-SYNTHETIC-001")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  await screen.findByText("REQ-SYNTHETIC-001");
  expect(posts).toHaveLength(3);
  expect(new Set(posts.map(item => item.requestId)).size).toBe(1);
  expect(posts[0].serviceIds).toEqual([serviceId]);
  expect(posts[0].airlineProfileId).toBe(airlineId);
});
