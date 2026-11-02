import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ElevantApiError, type ContractDocumentResponse } from "@elevant/api-client";
import { AirlineContractSignature } from "@/components/portal/AirlineContractSignature";

const sha = "c".repeat(64);
const document: ContractDocumentResponse = { contractId: "c-1", versionId: "v-1", contractCode: "CT-001",
  contractStatus: "Active", airlineName: "Demo Airlines", airlineCode: "ZZ", airlineLegalName: null, versionNumber: 1,
  versionStatus: "Approved", validFrom: "2026-01-01", validTo: null, currencyCode: "USD", stations: ["PUJ · Punta Cana"],
  rates: [], terms: null, signedOn: null, signatures: [], contentSha256: sha, signableBy: "Airline" };
const session = { getContractDocument: vi.fn(), downloadContractDocument: vi.fn(), signContract: vi.fn() };
vi.mock("@/components/auth/AirlineSessionProvider", () => ({ useAirlineSession: () => session }));

beforeEach(() => {
  session.getContractDocument.mockResolvedValue(document);
  session.downloadContractDocument.mockResolvedValue(new Blob(["%PDF-"], { type: "application/pdf" }));
  session.signContract.mockResolvedValue({ ...document, signableBy: null, signedOn: "2026-10-26", signatures: [
    { party: "Aviam", signerName: "Ana Pérez", signerTitle: "Gerente", signedAt: "2026-10-25T12:00:00Z", documentSha256: sha },
    { party: "Airline", signerName: "Luis Marte", signerTitle: "Director", signedAt: "2026-10-26T12:00:00Z", documentSha256: sha }] });
  URL.createObjectURL = vi.fn(() => "blob:contract");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("downloads the PDF and signs for the airline over the content hash with a stable key", async () => {
  render(<AirlineContractSignature versionId="v-1" fileName="contrato-CT-001-v1.pdf" />);
  expect(await screen.findAllByText("Pendiente de firma")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Descargar PDF" }));
  await waitFor(() => expect(session.downloadContractDocument).toHaveBeenCalledWith("v-1"));

  fireEvent.click(screen.getByRole("button", { name: "Acepto y firmo" }));
  expect(screen.getByRole("status")).toHaveTextContent("Escriba su nombre completo y cargo");
  fireEvent.change(screen.getByLabelText("Nombre completo de quien firma"), { target: { value: "Luis Marte" } });
  fireEvent.change(screen.getByLabelText("Cargo"), { target: { value: "Director" } });
  fireEvent.click(screen.getByRole("checkbox"));
  session.signContract.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  fireEvent.click(screen.getByRole("button", { name: "Acepto y firmo" }));
  await waitFor(() => expect(session.signContract).toHaveBeenCalledTimes(1));
  const key = session.signContract.mock.calls[0]![4];
  fireEvent.click(await screen.findByRole("button", { name: "Acepto y firmo" }));
  await screen.findByText("Firmado por ambas partes el 2026-10-26.");
  expect(session.signContract).toHaveBeenLastCalledWith("v-1", "Luis Marte", "Director", sha, key);
  expect(screen.queryByRole("button", { name: "Acepto y firmo" })).not.toBeInTheDocument();
});

it("hides the form once the airline signed and explains a foreign version", async () => {
  session.getContractDocument.mockRejectedValueOnce(new ElevantApiError({ kind: "http", status: 403, title: "Forbidden" }));
  render(<AirlineContractSignature versionId="v-2" fileName="x.pdf" />);
  expect(await screen.findByRole("status")).toHaveTextContent("Su cuenta no puede firmar este contrato.");
  expect(screen.queryByRole("button", { name: "Acepto y firmo" })).not.toBeInTheDocument();
});

it("prints the official PDF from a hidden frame instead of the web page", async () => {
  render(<AirlineContractSignature versionId="v-1" fileName="contrato-CT-001-v1.pdf" />);
  fireEvent.click(await screen.findByRole("button", { name: "Imprimir" }));
  await waitFor(() => expect(session.downloadContractDocument).toHaveBeenCalledWith("v-1"));
  const frame = await waitFor(() => {
    const element = window.document.querySelector<HTMLIFrameElement>("iframe[title^='Impresión']");
    expect(element).not.toBeNull();
    return element!;
  });
  expect(frame.getAttribute("src")).toBe("blob:contract");
  expect(frame).toHaveAttribute("aria-hidden", "true");
});

it("explains a failed download without leaving the buttons disabled", async () => {
  session.downloadContractDocument.mockRejectedValueOnce(new ElevantApiError({ kind: "http", status: 404 }));
  render(<AirlineContractSignature versionId="v-1" fileName="contrato-CT-001-v1.pdf" />);
  fireEvent.click(await screen.findByRole("button", { name: "Descargar PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("ya no está disponible");
  expect(screen.getByRole("button", { name: "Descargar PDF" })).toBeEnabled();
});
