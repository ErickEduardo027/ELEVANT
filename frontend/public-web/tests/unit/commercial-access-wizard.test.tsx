import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

/** The catalog with `count` numbered services, «Servicio 1» first. */
function catalogWith(count: number) {
  return { ...catalog, services: Array.from({ length: count }, (_, index) => ({
    id: `20000000-0000-7000-8000-${String(100 + index).padStart(12, "0")}`, name: `Servicio ${index + 1}`,
    description: "Ramp service", imageUrl: null, videoUrl: null, displayOrder: index + 1 })) };
}
const numbered = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => `Servicio ${from + index}`);

afterEach(() => {
  cleanup(); hubEvents.catalogChanged = null; vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

const field = (name: string) => screen.getByRole("combobox", { name });
const choose = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });

async function openRepresentativeStep() {
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  choose("Seleccione una aerolínea", airlineId);
  fillTax("131234569", "DO");
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
}

/** The airline's tax identifier of step 2; a Dominican airline fixes the country to DO. */
function fillTax(number: string, country?: string) {
  if (country) choose("País del identificador fiscal", country);
  fireEvent.change(screen.getByRole("textbox", { name: country === "DO" || !country ? "RNC" : "Identificador fiscal" }),
    { target: { value: number } });
}

async function chooseDominicanLocation() {
  choose("País", "DO");
  await waitFor(() => expect(field("Provincia / Estado / Región")).toBeEnabled());
  choose("Provincia / Estado / Región", "25");
  choose("Municipio / Ciudad", "Santiago de los Caballeros");
}

async function fillApplication() {
  await openRepresentativeStep();
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre completo" }),
    { target: { value: "Alex Test" } });
  choose("Cargo", "Gerente de operaciones");
  fireEvent.change(screen.getByRole("textbox", { name: "Correo corporativo" }),
    { target: { value: "alex@synthetic.example.test" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Teléfono" }),
    { target: { value: "+1 809 555 0100" } });
  choose("Tipo de documento", "NationalId");
  // Typed without dashes: the field shapes it as ###-#######-#.
  fireEvent.change(screen.getByRole("textbox", { name: "Número de documento" }), { target: { value: "00112345673" } });
  await chooseDominicanLocation();
  fireEvent.click(screen.getByRole("checkbox", { name: /Declaro que estoy autorizado/i }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
}

function stubCatalogOnly(extra?: (url: string) => Response | undefined) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith("commercial-catalog"))
      return new Response(JSON.stringify(catalog), { headers: { "content-type": "application/json" } });
    const response = extra?.(String(url));
    if (response) return response;
    throw new Error(`Unexpected request: ${url}`);
  }));
}

// CN-09: the airline step tells an airline already working with AVIAM to use its portal, without asking the server.
it("points airlines that already operate with AVIAM to their portal on the airline step", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  const notice = "Si su aerolínea ya opera con AVIAM, use su portal para gestionar contratos y servicios; "
    + "esta solicitud es para afiliaciones nuevas.";
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  expect(screen.queryByText(notice)).not.toBeInTheDocument();
  const calls = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(await screen.findByText(notice)).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
});

it("does not show representative errors before the user interacts", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  await openRepresentativeStep();
  expect(screen.queryByText("Ingrese su nombre completo.")).not.toBeInTheDocument();
  expect(field("Provincia / Estado / Región")).toBeDisabled();
  expect(field("Municipio / Ciudad")).toBeDisabled();

  fireEvent.change(screen.getByRole("textbox", { name: "Correo corporativo" }), { target: { value: "usuario@" } });
  fireEvent.blur(screen.getByRole("textbox", { name: "Correo corporativo" }));
  expect(screen.getByText("Ingrese un correo electrónico válido.")).toBeInTheDocument();
  expect(screen.queryByText("Ingrese su nombre completo.")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByText(/PASO 03 \/ 04/i)).toBeInTheDocument();
  expect(screen.getByText("Ingrese su nombre completo.")).toBeInTheDocument();
  expect(screen.getByText("Seleccione su cargo.")).toBeInTheDocument();
  expect(screen.getByText("Seleccione su país.")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Nombre completo" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Nombre completo" })).toHaveAttribute("aria-invalid", "true");
});

it("offers only cédula or passport and checks every character in its position", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  await openRepresentativeStep();
  expect([...field("Tipo de documento").querySelectorAll("option")].map((option) => option.textContent))
    .toEqual(["Seleccione", "Cédula", "Pasaporte"]);

  choose("Tipo de documento", "NationalId");
  const number = screen.getByRole("textbox", { name: "Número de documento" });
  fireEvent.change(number, { target: { value: "00112345673" } });
  expect(number).toHaveValue("001-1234567-3");

  // A Dominican passport takes only its 7 digits after the fixed RD: letters never reach the number.
  choose("Tipo de documento", "Passport");
  choose("Nacionalidad del pasaporte", "DO");
  const passport = screen.getByRole("textbox", { name: "Número de documento" });
  fireEvent.change(passport, { target: { value: "ab12x34567" } });
  expect(passport).toHaveValue("1234567");
  // Any other passport is checked character by character as before.
  choose("Nacionalidad del pasaporte", "US");
  const foreign = screen.getByRole("textbox", { name: "Número de documento" });
  expect(foreign).toHaveValue("1234567");
  fireEvent.change(foreign, { target: { value: "ab1234567" } });
  expect(foreign).toHaveValue("AB1234567");
});

it("formats the cédula key by key without repeating dashes", async () => {
  const { formatDocumentNumber } = await import("@/components/commercial/AccessRequestWizard");
  let typed = "";
  for (const digit of "00112345673") typed = formatDocumentNumber("NationalId", typed + digit);
  expect(typed).toBe("001-1234567-3");
  expect(formatDocumentNumber("NationalId", "402-1234")).toBe("402-1234");
  expect(formatDocumentNumber("NationalId", "402-")).toBe("402");
});

it("starts with a Dominican passport and writes its RD for the representative", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard, withDominicanPassportPrefix } = await import("@/components/commercial/AccessRequestWizard");
  expect(withDominicanPassportPrefix("Passport", "DO", "1234567")).toBe("RD1234567");
  expect(withDominicanPassportPrefix("Passport", "DO", "RD1234567")).toBe("RD1234567");
  expect(withDominicanPassportPrefix("Passport", "US", "123456789")).toBe("123456789");
  expect(withDominicanPassportPrefix("NationalId", "DO", "001")).toBe("001");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  await openRepresentativeStep();
  expect(field("Tipo de documento")).toHaveValue("Passport");
  expect(field("Nacionalidad del pasaporte")).toHaveValue("DO");
  // The RD is shown fixed beside the field, outside its name; the person types only the 7 digits.
  const number = screen.getByRole("textbox", { name: "Número de documento" });
  expect(number).toHaveValue("");
  expect(number).toHaveAttribute("maxLength", "7");
  expect(number).toHaveAttribute("inputMode", "numeric");
  expect(screen.getByTitle("Pasaporte dominicano")).toHaveTextContent("RD");
  const met = () => within(screen.getByRole("list", { name: "Requisitos del número de documento" }))
    .getAllByRole("listitem").map((item) => item.getAttribute("data-met"));
  fireEvent.change(number, { target: { value: "123" } });
  expect(number).toHaveValue("123");
  // The stored number already starts with RD: the checklist marks it.
  expect(met()[0]).toBe("true");
  fireEvent.change(number, { target: { value: "1234567" } });
  expect(number).toHaveValue("1234567");
  expect(met().every((item) => item === "true")).toBe(true);
  // Typed or pasted with its RD, the prefix is not repeated.
  fireEvent.change(number, { target: { value: "rd7654321" } });
  expect(number).toHaveValue("7654321");
  fireEvent.paste(number, { clipboardData: { getData: () => "RD1122334" } });
  expect(number).toHaveValue("1122334");
  // A cédula has no prefix and keeps what was typed.
  choose("Tipo de documento", "NationalId");
  expect(screen.queryByTitle("Pasaporte dominicano")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Número de documento" })).toHaveValue("112-2334");
});

it("shows the document requirements while typing and turns them green as they are met", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  await openRepresentativeStep();
  choose("Tipo de documento", "NationalId");
  const number = screen.getByRole("textbox", { name: "Número de documento" });
  expect(screen.queryByRole("list", { name: "Requisitos del número de documento" })).not.toBeInTheDocument();
  const met = () => within(screen.getByRole("list", { name: "Requisitos del número de documento" }))
    .getAllByRole("listitem").map((item) => item.getAttribute("data-met"));

  for (const digit of "001") fireEvent.change(number, { target: { value: (number as HTMLInputElement).value + digit } });
  expect(number).toHaveValue("001");
  expect(met()).toEqual(["true", "false", "false", "false"]);
  expect(screen.getByText("11 dígitos (3/11)")).toBeInTheDocument();

  for (const digit of "12345673") fireEvent.change(number, { target: { value: (number as HTMLInputElement).value + digit } });
  expect(number).toHaveValue("001-1234567-3");
  expect(met()).toEqual(["true", "true", "true", "true"]);
});

it("asks for a custom title only while Otro is selected", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  await openRepresentativeStep();
  expect(screen.queryByRole("textbox", { name: "Especifique su cargo" })).not.toBeInTheDocument();

  choose("Cargo", "Otro");
  const custom = screen.getByRole("textbox", { name: "Especifique su cargo" });
  fireEvent.blur(custom);
  expect(screen.getByText("Escriba su cargo.")).toBeInTheDocument();
  fireEvent.change(custom, { target: { value: "Jefe de escala" } });
  expect(screen.queryByText("Escriba su cargo.")).not.toBeInTheDocument();

  choose("Cargo", "Gerente de estación");
  expect(screen.queryByRole("textbox", { name: "Especifique su cargo" })).not.toBeInTheDocument();
  choose("Cargo", "Otro");
  expect(screen.getByRole("textbox", { name: "Especifique su cargo" })).toHaveValue("");
});

it("keeps country, division and municipality consistent", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly((url) => url.endsWith("/geo/US.json") ? new Response(JSON.stringify({ divisions: [
    { code: "FL", name: "Florida", cities: ["Miami", "Orlando"] },
  ] }), { headers: { "content-type": "application/json" } }) : undefined);
  render(<AccessRequestWizard />);
  await openRepresentativeStep();

  await chooseDominicanLocation();
  const provinces = within(field("Provincia / Estado / Región")).getAllByRole("option");
  expect(provinces).toHaveLength(33);
  expect(field("Municipio / Ciudad")).toHaveValue("Santiago de los Caballeros");

  choose("Provincia / Estado / Región", "01");
  expect(field("Municipio / Ciudad")).toHaveValue("");
  expect(within(field("Municipio / Ciudad")).getAllByRole("option").map((option) => option.textContent))
    .toEqual(["Seleccione una opción", "Santo Domingo de Guzmán"]);

  choose("País", "US");
  expect(field("Provincia / Estado / Región")).toHaveValue("");
  expect(field("Municipio / Ciudad")).toHaveValue("");
  expect(field("Municipio / Ciudad")).toBeDisabled();
  await waitFor(() => expect(field("Provincia / Estado / Región")).toBeEnabled());
  choose("Provincia / Estado / Región", "FL");
  expect(field("Municipio / Ciudad")).toBeEnabled();
  choose("Municipio / Ciudad", "Miami");
  expect(field("Municipio / Ciudad")).toHaveValue("Miami");
});

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
  expect(posts[0]).toMatchObject({
    representativeTitle: "Gerente de operaciones",
    representativeCountry: "República Dominicana",
    representativeProvince: "Santiago",
    representativeMunicipality: "Santiago de los Caballeros",
  });
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

it("shows the public-registry seal in step 2 only for airlines the registry confirmed", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const confirmedId = "20000000-0000-7000-8000-000000000009";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url) => {
    if (!String(url).endsWith("commercial-catalog")) throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify({ ...catalog, airlines: [...catalog.airlines,
      { id: confirmedId, name: "Copa Airlines", region: "Central America", legalName: null, countryCode: "PA",
        iataCode: "CM", icaoCode: "CMP", logoUrl: null, isVerified: false, registrySource: "Wikidata" }] }),
    { headers: { "content-type": "application/json" } });
  }));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  choose("Seleccione una aerolínea", airlineId);
  expect(screen.queryByText(/Verificada en registro público/)).not.toBeInTheDocument();
  choose("Seleccione una aerolínea", confirmedId);
  expect(await screen.findByText(/Verificada en registro público \(Wikidata\)/)).toBeInTheDocument();
});

async function fillRepresentative() {
  fireEvent.change(screen.getByRole("textbox", { name: "Nombre completo" }), { target: { value: "Alex Test" } });
  choose("Cargo", "Gerente de operaciones");
  fireEvent.change(screen.getByRole("textbox", { name: "Correo corporativo" }),
    { target: { value: "alex@caribecargo.example.com" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Teléfono" }), { target: { value: "+1 809 555 0100" } });
  choose("Tipo de documento", "NationalId");
  fireEvent.change(screen.getByRole("textbox", { name: "Número de documento" }), { target: { value: "00112345673" } });
  await chooseDominicanLocation();
  fireEvent.click(screen.getByRole("checkbox", { name: /Declaro que estoy autorizado/i }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
}

it("proposes an airline that is not in the listing, with its ICAO code and no IATA", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog"))
      return new Response(JSON.stringify(catalog), { headers: { "content-type": "application/json" } });
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ reference: "REQ-PROPOSAL", replayed: false }),
        { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  fireEvent.click(screen.getByRole("button", { name: "Mi aerolínea no aparece" }));
  expect(screen.queryByRole("combobox", { name: "Seleccione una aerolínea" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByText("Escriba el nombre de la aerolínea.")).toBeInTheDocument();
  expect(screen.getByText("Escriba el código ICAO de la aerolínea: 3 letras.")).toBeInTheDocument();
  expect(screen.getByText(/PASO 02 \/ 04/i)).toBeInTheDocument();

  fireEvent.change(screen.getByRole("textbox", { name: "Nombre de la aerolínea" }), { target: { value: "Caribe Cargo Express" } });
  choose("País de la aerolínea", "DO");
  fireEvent.change(screen.getByRole("textbox", { name: "Código ICAO" }), { target: { value: "ccx" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Sitio web oficial (opcional)" }),
    { target: { value: "https://caribecargo.example.com" } });
  // A Dominican airline gives its RNC; the country of the identifier is fixed to the airline's.
  expect(field("País del identificador fiscal")).toBeDisabled();
  expect(field("País del identificador fiscal")).toHaveValue("DO");
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByText("Escriba el RNC de la aerolínea.")).toBeInTheDocument();
  // Fewer than 9 digits get one short message; the check digit is not verified.
  fillTax("13123456");
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByText("El RNC tiene 9 dígitos.")).toBeInTheDocument();
  fillTax("1-31-23456-9");
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByText(/en nombre de Caribe Cargo Express/)).toBeInTheDocument();
  await fillRepresentative();
  expect(screen.getByText(/No figura en el listado · República Dominicana · ICAO CCX · Sin IATA · https:\/\/caribecargo\.example\.com · RNC 1-31-23456-9/))
    .toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  expect(await screen.findByText("REQ-PROPOSAL")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("le escribirá a alex@caribecargo.example.com con su decisión");
  expect(posts[0]).toMatchObject({ airlineProfileId: null, proposedAirline: { name: "Caribe Cargo Express",
    countryCode: "DO", iataCode: null, icaoCode: "CCX", websiteUrl: "https://caribecargo.example.com" },
    taxRegistration: "131234569", taxRegistrationCountryCode: "DO" });
});

it("asks a foreign airline for its own tax identifier, with the airline's country by default", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const panama = "20000000-0000-7000-8000-000000000010";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...catalog, airlines: [
    { ...catalog.airlines[0], id: panama, name: "Copa Airlines", countryCode: "PA" }] }),
  { headers: { "content-type": "application/json" } })));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  choose("Seleccione una aerolínea", panama);
  expect(field("País del identificador fiscal")).toHaveValue("PA");
  const number = screen.getByRole("textbox", { name: "Identificador fiscal" });
  fireEvent.change(number, { target: { value: "ab" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(number).toHaveFocus();
  expect(screen.getByText("El identificador fiscal tiene de 3 a 32 caracteres.")).toBeInTheDocument();
  fireEvent.change(number, { target: { value: "155596713-2-2015" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByText(/PASO 03 \/ 04/i)).toBeInTheDocument();
});

it("prefills the RNC of the catalog profile, masked and still editable, and says at once whether it is valid", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const caribe = "20000000-0000-7000-8000-000000000011";
  const panamaId = "20000000-0000-7000-8000-000000000012";
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("commercial-catalog"))
      return new Response(JSON.stringify({ ...catalog, airlines: [...catalog.airlines,
        { ...catalog.airlines[0], id: panamaId, name: "Panamá Air", countryCode: "PA" }, { ...catalog.airlines[0], id: caribe,
        name: "Caribe Air", legalName: "Caribe Air S.R.L.", countryCode: "DO", iataCode: null, icaoCode: "CRX",
        taxRegistration: "131234569", taxRegistrationCountryCode: "DO" }] }), { headers: { "content-type": "application/json" } });
    if (String(url).endsWith("commercial-requests") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ reference: "REQ-RNC", replayed: false }),
        { status: 201, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  choose("Seleccione una aerolínea", caribe);
  expect(screen.getByRole("textbox", { name: "Razón social" })).toHaveValue("Caribe Air S.R.L.");
  expect(screen.getByRole("textbox", { name: "Código ICAO" })).toHaveValue("CRX");
  expect(field("País del identificador fiscal")).toHaveValue("DO");
  const rnc = screen.getByRole("textbox", { name: "RNC" });
  expect(rnc).toHaveValue("1-31-23456-9");
  expect(rnc).toHaveAttribute("inputMode", "numeric");
  expect(screen.getByRole("status")).toHaveTextContent("RNC válido");

  // The mask adds the dashes while typing; any 9 digits are an RNC (no check digit).
  fireEvent.change(rnc, { target: { value: "13123" } });
  expect(rnc).toHaveValue("1-31-23");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  fireEvent.change(rnc, { target: { value: "1312345680" } });
  expect(rnc).toHaveValue("1-31-23456-8");
  expect(screen.getByRole("status")).toHaveTextContent("RNC válido");
  expect(screen.queryByText(/dígito verificador/)).not.toBeInTheDocument();
  fireEvent.change(rnc, { target: { value: "1-31-23456-9" } });

  // Another airline replaces both values: without an RNC in its profile, its own country and an empty number.
  choose("Seleccione una aerolínea", panamaId);
  expect(field("País del identificador fiscal")).toHaveValue("PA");
  expect(screen.getByRole("textbox", { name: "Identificador fiscal" })).toHaveValue("");
  choose("Seleccione una aerolínea", caribe);
  expect(screen.getByRole("textbox", { name: "RNC" })).toHaveValue("1-31-23456-9");
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  await fillRepresentative();
  // The confirmation separates every fact of the airline, the RNC included, and names the country (N16).
  expect(screen.getByText("Caribe Air S.R.L. · República Dominicana · RNC 1-31-23456-9")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Enviar solicitud/i }));
  expect(await screen.findByText("REQ-RNC")).toBeInTheDocument();
  expect(posts[0]).toMatchObject({ airlineProfileId: caribe, taxRegistration: "131234569", taxRegistrationCountryCode: "DO" });
});

it("offers the proposal right away when no airline is published and points to a listed ICAO code", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...catalog, airlines: [] }),
    { headers: { "content-type": "application/json" } })));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(screen.getByRole("note")).toHaveTextContent("Aún no hay aerolíneas publicadas");
  expect(screen.getByRole("textbox", { name: "Nombre de la aerolínea" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Elegir del listado" })).not.toBeInTheDocument();
  cleanup();

  const listed = { ...catalog.airlines[0], name: "Copa Airlines", icaoCode: "CMP", iataCode: "CM" };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...catalog, airlines: [listed] }),
    { headers: { "content-type": "application/json" } })));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  fireEvent.click(screen.getByRole("button", { name: "Mi aerolínea no aparece" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Código ICAO" }), { target: { value: "cmp" } });
  expect(screen.getByRole("note")).toHaveTextContent("ya figura en el listado");
  fireEvent.click(screen.getByRole("button", { name: "Elegir Copa Airlines" }));
  expect(screen.getByRole("combobox", { name: "Seleccione una aerolínea" })).toHaveValue(airlineId);
});

it("describes each field of a proposed airline with its error and its help (1-N25)", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  fireEvent.click(screen.getByRole("button", { name: "Mi aerolínea no aparece" }));
  const name = screen.getByRole("textbox", { name: "Nombre de la aerolínea" });
  const icao = screen.getByRole("textbox", { name: "Código ICAO" });
  const iataHelp = "Déjelo vacío si la aerolínea no tiene código IATA.";
  // Before an attempt only the help describes a field.
  expect(icao).toHaveAccessibleDescription("Obligatorio: 3 letras, por ejemplo CMP.");
  expect(name).not.toHaveAttribute("aria-describedby");

  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(name).toHaveFocus();
  expect(name).toHaveAccessibleDescription("Escriba el nombre de la aerolínea.");
  expect(field("País de la aerolínea")).toHaveAccessibleDescription("Seleccione el país de la aerolínea.");
  expect(icao).toHaveAccessibleDescription(
    "Escriba el código ICAO de la aerolínea: 3 letras. Obligatorio: 3 letras, por ejemplo CMP.");
  expect(screen.getByRole("textbox", { name: "Código IATA (opcional)" })).toHaveAccessibleDescription(iataHelp);
  expect(screen.getByRole("textbox", { name: "Sitio web oficial (opcional)" }))
    .toHaveAccessibleDescription("Ayuda a Contratos a confirmar la aerolínea y a su representante.");

  // The focus goes to the field still wrong, which says why.
  fireEvent.change(name, { target: { value: "Caribe Cargo Express" } });
  choose("País de la aerolínea", "DO");
  fireEvent.change(icao, { target: { value: "cm" } });
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(icao).toHaveFocus();
  expect(icao).toHaveAttribute("aria-invalid", "true");
  expect(icao).toHaveAccessibleDescription(
    "Escriba el código ICAO de la aerolínea: 3 letras. Obligatorio: 3 letras, por ejemplo CMP.");
  expect(name).not.toHaveAttribute("aria-describedby");
});

const shownServices = () => within(screen.getByLabelText("Servicios disponibles"))
  .getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

it("shows six services per page and announces only the range of the page (N15)", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify(catalogWith(9)),
    { headers: { "content-type": "application/json" } })));
  render(<AccessRequestWizard />);
  const range = await screen.findByText("SERVICIOS 1–6 DE 9");
  expect(within(screen.getByLabelText("Servicios disponibles")).getAllByRole("article")).toHaveLength(6);
  expect(shownServices()).toEqual(numbered(1, 6));
  // The range has its own live region; the panel no longer reads every change of the step aloud.
  expect(range).toHaveAttribute("aria-live", "polite");
  expect(screen.getByText(/PASO 01 \/ 04/).closest("section")).not.toHaveAttribute("aria-live");
  expect(screen.getByText("0 SELECCIONADOS")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ver servicios anteriores" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Ver servicios siguientes" }));
  expect(range).toHaveTextContent("SERVICIOS 7–9 DE 9");
  expect(shownServices()).toEqual(numbered(7, 9));
  expect(screen.getByRole("button", { name: "Ver servicios siguientes" })).toBeDisabled();
  fireEvent.click(within(screen.getByLabelText("Servicios disponibles")).getAllByRole("button", { name: "Añadir servicio +" })[0]);
  expect(screen.getByText("1 SELECCIONADO")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Ver servicios anteriores" }));
  expect(range).toHaveTextContent("SERVICIOS 1–6 DE 9");
  expect(shownServices()).toEqual(numbered(1, 6));
});

it("pages back from the page on screen after services are withdrawn (N15)", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url) => {
    if (!String(url).endsWith("commercial-catalog")) throw new Error(`Unexpected request: ${url}`);
    reads += 1;
    return new Response(JSON.stringify(catalogWith(reads === 1 ? 13 : 9)), { headers: { "content-type": "application/json" } });
  }));
  render(<AccessRequestWizard />);
  const range = await screen.findByText("SERVICIOS 1–6 DE 13");
  fireEvent.click(screen.getByRole("button", { name: "Ver servicios siguientes" }));
  fireEvent.click(screen.getByRole("button", { name: "Ver servicios siguientes" }));
  expect(range).toHaveTextContent("SERVICIO 13 DE 13");
  expect(shownServices()).toEqual(["Servicio 13"]);

  // Four services are withdrawn: the third page no longer exists, so the second one is on screen.
  await act(async () => { hubEvents.catalogChanged?.(); });
  expect(range).toHaveTextContent("SERVICIOS 7–9 DE 9");
  // «←» goes to the page before the one on screen, not to the one before the vanished third page.
  fireEvent.click(screen.getByRole("button", { name: "Ver servicios anteriores" }));
  expect(range).toHaveTextContent("SERVICIOS 1–6 DE 9");
  expect(shownServices()).toEqual(numbered(1, 6));
});

it("names the airline's country in Spanish and shows a verified identity apart (N16)", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const verifiedId = "20000000-0000-7000-8000-000000000013";
  const legacyId = "20000000-0000-7000-8000-000000000014";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...catalog, airlines: [
    catalog.airlines[0],
    { ...catalog.airlines[0], id: verifiedId, name: "Synthetic Verified", countryCode: "us", isVerified: true },
    { ...catalog.airlines[0], id: legacyId, name: "Synthetic Legacy", countryCode: "USA" }] }),
  { headers: { "content-type": "application/json" } })));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));

  choose("Seleccione una aerolínea", verifiedId);
  expect(screen.getByRole("textbox", { name: "País" })).toHaveValue("Estados Unidos");
  expect(screen.getByText("✓ Identidad verificada por AVIAM")).toHaveAttribute("data-verified", "true");
  // A value that is not an ISO code is shown as it came, without breaking the step.
  choose("Seleccione una aerolínea", legacyId);
  expect(screen.getByRole("textbox", { name: "País" })).toHaveValue("USA");
  expect(screen.getByText(/Contratos verificará la identidad legal/)).toHaveAttribute("data-verified", "false");
  choose("Seleccione una aerolínea", airlineId);
  expect(screen.getByRole("textbox", { name: "País" })).toHaveValue("Sin dato confirmado");
});

it("names a country code in any case and never throws on a value Intl does not accept (N16)", async () => {
  const { countryLabel } = await import("@/lib/geo/catalog");
  expect(countryLabel("US")).toBe("Estados Unidos");
  expect(countryLabel("us")).toBe("Estados Unidos");
  expect(countryLabel(" do ")).toBe("República Dominicana");
  // Intl.DisplayNames throws a RangeError for «USA»: it is shown as it came.
  expect(() => countryLabel("USA")).not.toThrow();
  expect(countryLabel("USA")).toBe("USA");
  expect(countryLabel("")).toBeNull();
  expect(countryLabel(null)).toBeNull();
  expect(countryLabel(undefined)).toBeNull();
});

it("takes the focus to the heading of each step it opens, never on the first render (N15)", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  stubCatalogOnly();
  render(<AccessRequestWizard />);
  await screen.findByRole("button", { name: "Añadir servicio +" });
  // Opening the page leaves the focus alone. The panel is no live region, so a new step is heard through its heading.
  expect(document.body).toHaveFocus();
  const heading = (name: string) => screen.getByRole("heading", { level: 2, name });
  await fillApplication();
  expect(heading("Revise su solicitud.")).toHaveFocus();
  // «Editar servicios» unmounts the button that had the focus.
  fireEvent.click(screen.getByRole("button", { name: "Editar servicios" }));
  expect(heading("¿Qué necesita su operación?")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  expect(heading("¿A cuál aerolínea representa?")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "← Volver" }));
  expect(heading("¿Qué necesita su operación?")).toHaveFocus();
});

it("announces a proposed ICAO code that is already listed and describes the field with it (N15)", async () => {
  vi.stubEnv("NEXT_PUBLIC_ELEVANT_API_URL", "https://api.example.test");
  const { AccessRequestWizard } = await import("@/components/commercial/AccessRequestWizard");
  const listed = { ...catalog.airlines[0], name: "Copa Airlines", icaoCode: "CMP", iataCode: "CM" };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ...catalog, airlines: [listed] }),
    { headers: { "content-type": "application/json" } })));
  render(<AccessRequestWizard />);
  fireEvent.click(await screen.findByRole("button", { name: "Añadir servicio +" }));
  fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));
  fireEvent.click(screen.getByRole("button", { name: "Mi aerolínea no aparece" }));
  const icao = screen.getByRole("textbox", { name: "Código ICAO" });
  // The region exists before the note: what is inserted into it is read aloud wherever the focus is.
  const regions = [...document.querySelectorAll('[aria-live="polite"]')];
  fireEvent.change(icao, { target: { value: "cmp" } });
  const note = screen.getByRole("note");
  expect(note).toHaveTextContent("El código CMP corresponde a Copa Airlines, que ya figura en el listado.");
  expect(regions).toContain(note.closest('[aria-live="polite"]'));
  expect(icao).toHaveAccessibleDescription(/ya figura en el listado/);
  // Another code takes the note away, and the description with it.
  fireEvent.change(icao, { target: { value: "cmx" } });
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(icao).toHaveAccessibleDescription("Obligatorio: 3 letras, por ejemplo CMP.");
});
