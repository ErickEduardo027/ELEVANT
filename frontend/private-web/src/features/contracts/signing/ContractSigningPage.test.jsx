import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractSigningPage from './ContractSigningPage';
import { listContractSigning, listAviamSigners, issueContract } from '../../../services/contractSigningService';

vi.mock('../../../services/contractSigningService', () => ({
  listContractSigning: vi.fn(), listAviamSigners: vi.fn(),
  setContractSigner: vi.fn(), previewContractPdf: vi.fn(), getContractDraftPdf: vi.fn(), acceptAviamContract: vi.fn(),
  issueContract: vi.fn(), getSignedContractPdf: vi.fn(), getContractAuditPdf: vi.fn(),
}));
vi.mock('../../../services/commercialGovernanceApi', () => ({ getCommercialRequests: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));

const pending = {
  contractId: '60000000-0000-7000-8000-000000000001',
  versionId: '60000000-0000-7000-8000-000000000002',
  contractCode: 'DEV-CTR-1', airlineName: 'Synthetic Air',
  versionStatus: 'Approved', signingStatus: 'AwaitingEmission',
  requiresElectronicSigning: true, aviamSignerEmail: 'aviam@example.test',
  airlineSignerEmail: 'airline@example.test', draftSha256: 'a'.repeat(64),
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps emission unavailable without the specific permission', async () => {
  listContractSigning.mockResolvedValue([pending]);
  listAviamSigners.mockResolvedValue([]);
  render(<ContractSigningPage canPreview={false} canIssue={false} />);
  expect(await screen.findByText('DEV-CTR-1')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /modelo/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Emitir contrato' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Preparar y revisar PDF' })).not.toBeInTheDocument();
});

it('emits an approved version only through the explicit action', async () => {
  listContractSigning.mockResolvedValue([pending]);
  listAviamSigners.mockResolvedValue([]);
  issueContract.mockResolvedValue({ ...pending, signingStatus: 'Issued' });
  render(<ContractSigningPage canPreview={true} canIssue={true} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Emitir contrato' }));
  expect(issueContract).toHaveBeenCalledExactlyOnceWith(pending.versionId);
  expect(await screen.findByRole('status')).toHaveTextContent('Expediente emitido');
});
