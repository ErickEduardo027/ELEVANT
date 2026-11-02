import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractPdfButtons from './ContractPdfButtons';
import { loadContractPdf } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({ loadContractPdf: vi.fn() }));

beforeEach(() => {
  loadContractPdf.mockResolvedValue(new Blob(['%PDF-'], { type: 'application/pdf' }));
  URL.createObjectURL = vi.fn(() => 'blob:draft');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); document.querySelectorAll('iframe').forEach(item => item.remove()); });

it('downloads and prints the watermarked draft copy', async () => {
  render(<ContractPdfButtons versionId="v-9" fileName="borrador-CT-9.pdf" draft />);
  await userEvent.click(screen.getByRole('button', { name: 'Descargar borrador (PDF)' }));
  expect(loadContractPdf).toHaveBeenCalledWith('v-9', { draft: true });
  await userEvent.click(screen.getByRole('button', { name: 'Imprimir' }));
  await waitFor(() => expect(document.querySelector('iframe[title="Impresión de borrador-CT-9.pdf"]')).not.toBeNull());
  expect(document.querySelector('iframe').getAttribute('src')).toBe('blob:draft');
});

it('reports a forbidden document and re-enables the buttons', async () => {
  loadContractPdf.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
  render(<ContractPdfButtons versionId="v-9" fileName="contrato.pdf" />);
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso');
  expect(screen.getByRole('button', { name: 'Imprimir' })).toBeEnabled();
});
