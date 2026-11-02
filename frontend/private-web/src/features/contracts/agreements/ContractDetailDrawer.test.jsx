import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractDetailDrawer from './ContractDetailDrawer';
import { getContractDocument, loadContractPdf, signContractVersion } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getContractDocument: vi.fn(), loadContractPdf: vi.fn(), signContractVersion: vi.fn(),
  getContractTimeline: vi.fn().mockResolvedValue({ contractId: 'c-1', contractCode: 'CT-001', status: 'Active', entries: [] }),
  applyContractLifecycle: vi.fn(),
}));

const sha = 'b'.repeat(64);
const document = { contractId: 'c-1', versionId: 'v-1', contractCode: 'CT-001', contractStatus: 'Active', airlineName: 'Demo Air',
  airlineCode: 'DM', airlineLegalName: 'Demo Air S.A.', versionNumber: 2, versionStatus: 'Approved', validFrom: '2026-01-01',
  validTo: null, currencyCode: 'USD', stations: ['PUJ · Punta Cana'], terms: 'Pago a 30 días.', signedOn: null,
  rates: [{ serviceCode: 'RAMP', serviceName: 'Rampa', billingUnit: 'operación', unitPrice: 150, minimumQuantity: 1 }],
  signatures: [], contentSha256: sha, signableBy: 'Aviam' };

beforeEach(() => {
  getContractDocument.mockResolvedValue(document);
  loadContractPdf.mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }));
  URL.createObjectURL = vi.fn(() => 'blob:contract');
  URL.revokeObjectURL = vi.fn();
  signContractVersion.mockResolvedValue({ ...document, signableBy: null, signatures: [
    { party: 'Aviam', signerName: 'Ana Pérez', signerTitle: 'Gerente comercial', signedAt: '2026-10-26T12:00:00Z', documentSha256: sha }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows the formal content, downloads the PDF and signs for AVIAM over the shown hash', async () => {
  const onSigned = vi.fn();
  render(<ContractDetailDrawer versionId="v-1" canSign onClose={vi.fn()} onSigned={onSigned} />);
  const drawer = await screen.findByRole('dialog', { name: 'Contrato CT-001 · versión 2' });
  expect(drawer).toHaveTextContent('Demo Air S.A. (DM)');
  expect(drawer).toHaveTextContent('Pago a 30 días.');
  expect(drawer).toHaveTextContent(`Huella SHA-256: ${sha}`);
  expect(within(screen.getByRole('region', { name: 'Firmas' })).getAllByText('Pendiente de firma')).toHaveLength(2);

  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(loadContractPdf).toHaveBeenCalledWith('v-1', { draft: false });
  expect(screen.getByRole('button', { name: 'Imprimir' })).toBeEnabled();

  await userEvent.click(screen.getByRole('button', { name: 'Acepto y firmo' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Escribe tu nombre completo y cargo');
  expect(signContractVersion).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Nombre completo'), 'Ana Pérez');
  await userEvent.type(screen.getByLabelText('Cargo'), 'Gerente comercial');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Acepto y firmo' }));
  expect(signContractVersion).toHaveBeenCalledWith('v-1', { signerName: 'Ana Pérez', signerTitle: 'Gerente comercial',
    accepted: true, documentSha256: sha }, expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(await screen.findByText('Ana Pérez · Gerente comercial')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
  expect(onSigned).toHaveBeenCalled();
});

it('offers no signature without «Firmar por AVIAM» and explains a missing document', async () => {
  render(<ContractDetailDrawer versionId="v-1" onClose={vi.fn()} />);
  await screen.findByRole('dialog', { name: 'Contrato CT-001 · versión 2' });
  expect(screen.queryByRole('button', { name: 'Acepto y firmo' })).not.toBeInTheDocument();
  cleanup();
  getContractDocument.mockRejectedValueOnce({ status: 404 });
  render(<ContractDetailDrawer versionId="v-9" canSign onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('ya no tiene documento');
});
