import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractDetailDrawer from './ContractDetailDrawer';
import {
  getContractDocument, loadContractPdf, setContractValidity, signContractVersion,
} from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getContractDocument: vi.fn(), loadContractPdf: vi.fn(), signContractVersion: vi.fn(), setContractValidity: vi.fn(),
  getContractTimeline: vi.fn().mockResolvedValue({ contractId: 'c-1', contractCode: 'CT-001', status: 'Active', entries: [] }),
  applyContractLifecycle: vi.fn(),
}));

const sha = 'b'.repeat(64);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const validity = { renewalMode: 'Automatic', renewalTermMonths: 12, renewalNoticeDays: 30, terminationNoticeDays: 60,
  terminationTerms: 'Incumplimiento grave.', confirmedAt: '2026-11-03T12:00:00Z' };
const airlineSignature = { party: 'Airline', signerName: 'Luis Marte', signerTitle: 'Director', signedAt: '2026-11-03T13:00:00Z',
  documentSha256: sha, hasDrawnSignature: true };
const document = { contractId: 'c-1', versionId: 'v-1', contractCode: 'CTR-2026-0001', contractStatus: 'Draft', airlineName: 'Demo Air',
  airlineCode: 'DM', airlineLegalName: 'Demo Air S.A.', versionNumber: 2, versionStatus: 'Approved', validFrom: '2026-11-03',
  validTo: '2027-11-02', currencyCode: 'USD', stations: ['PUJ · Punta Cana'], terms: 'Pago a 30 días.', signedOn: null,
  rates: [{ serviceCode: 'RAMP', serviceName: 'Rampa', billingUnit: 'operación', unitPrice: 150, minimumQuantity: 1 }],
  signatures: [airlineSignature], contentSha256: sha, signableBy: 'Aviam', validity };

beforeEach(() => {
  getContractDocument.mockResolvedValue(document);
  loadContractPdf.mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }));
  URL.createObjectURL = vi.fn(() => 'blob:contract');
  URL.revokeObjectURL = vi.fn();
  // jsdom has no canvas: a minimal 2D context lets the signature pad record strokes.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), stroke: vi.fn() }));
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => png);
  signContractVersion.mockResolvedValue({ ...document, signableBy: null, signedOn: '2026-11-03', signatures: [airlineSignature,
    { party: 'Aviam', signerName: 'Ana Pérez', signerTitle: 'Gerente comercial', signedAt: '2026-11-03T14:00:00Z',
      documentSha256: sha, hasDrawnSignature: true }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function draw(name = 'Firma') {
  const pad = screen.getByRole('img', { name });
  fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 60, clientY: 30, pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });
}

it('shows the formal content and validity, and countersigns for AVIAM with a drawn signature', async () => {
  const onSigned = vi.fn();
  render(<ContractDetailDrawer versionId="v-1" canSign onClose={vi.fn()} onSigned={onSigned} />);
  const drawer = await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  expect(drawer).toHaveTextContent('Demo Air S.A. (DM)');
  expect(drawer).toHaveTextContent('Renovación automática por 12 meses');
  expect(drawer).toHaveTextContent('Terminación con 60 días de preaviso. Incumplimiento grave.');
  expect(drawer).toHaveTextContent(`Huella SHA-256: ${sha}`);
  const signatures = within(screen.getByRole('region', { name: 'Firmas' }));
  expect(signatures.getByText(/firma dibujada/)).toBeInTheDocument();
  expect(signatures.getByText('Contrafirma después de la aerolínea')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(loadContractPdf).toHaveBeenCalledWith('v-1', { draft: false });

  await userEvent.type(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
  await userEvent.type(screen.getByLabelText('Cargo'), 'Gerente comercial');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Acepto y firmo' }));
  expect(screen.getByRole('alert')).toHaveTextContent('dibuja tu firma');
  expect(signContractVersion).not.toHaveBeenCalled();
  draw();
  await userEvent.click(screen.getByRole('button', { name: 'Acepto y firmo' }));
  expect(signContractVersion).toHaveBeenCalledWith('v-1', { signerName: 'Ana Pérez', signerTitle: 'Gerente comercial',
    accepted: true, signatureImagePng: png, documentSha256: sha }, expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(await screen.findByText('Ana Pérez · Gerente comercial')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
  expect(onSigned).toHaveBeenCalled();
});

it('lets Contratos confirm validity and renewal before any signature', async () => {
  const unconfirmed = { ...document, contractCode: 'DRAFT-1', validity: null, signatures: [], signableBy: null };
  getContractDocument.mockResolvedValueOnce(unconfirmed);
  setContractValidity.mockResolvedValue({ ...unconfirmed, contractCode: 'CTR-2026-0001', validity, signableBy: null });
  render(<ContractDetailDrawer versionId="v-1" canSign canSetValidity onClose={vi.fn()} />);
  const form = await screen.findByRole('form', { name: 'Vigencia y renovación' });
  expect(screen.getByText(/Pendiente: Contratos debe fijar la vigencia/)).toBeInTheDocument();
  await userEvent.selectOptions(within(form).getByLabelText('Renovación'), 'Automatic');
  await userEvent.clear(within(form).getByLabelText('Aviso de renovación (días antes)'));
  await userEvent.type(within(form).getByLabelText('Aviso de renovación (días antes)'), '45');
  await userEvent.type(within(form).getByLabelText('Condiciones de terminación'), 'Incumplimiento grave.');
  await userEvent.click(within(form).getByRole('button', { name: 'Confirmar vigencia' }));
  expect(setContractValidity).toHaveBeenCalledWith('v-1', { validFrom: '2026-11-03', validTo: '2027-11-02',
    renewalMode: 'Automatic', renewalTermMonths: 12, renewalNoticeDays: 45, terminationNoticeDays: 60,
    terminationTerms: 'Incumplimiento grave.', expectedDocumentSha256: sha });
  expect(await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
});

it('offers no signature without «Firmar por AVIAM» and explains a missing document', async () => {
  render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  await screen.findByRole('dialog', { name: 'Contrato CTR-2026-0001 · versión 2' });
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Vigencia y renovación' })).not.toBeInTheDocument();
  cleanup();
  getContractDocument.mockRejectedValueOnce({ status: 404 });
  render(<ContractDetailDrawer versionId="v-9" canSign onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('ya no tiene documento');
});
