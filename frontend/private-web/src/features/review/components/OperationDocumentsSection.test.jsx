import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ get: vi.fn(), download: vi.fn() }));
vi.mock('../../../services/occDocumentsService', async importOriginal => ({
  ...(await importOriginal()),
  getOccOperationDocuments: mocks.get,
  downloadOccOperationDocument: mocks.download,
}));

import OperationDocumentsSection from './OperationDocumentsSection';

const operationId = '70000000-0000-7000-8000-000000000005';
const order = {
  kind: 'ServiceOrder', number: 'PUJ000000005', title: 'Orden de Servicio', formCode: 'F-RAM-AVL-MAG 04',
  contentSha256: 'a'.repeat(64), requiredRoles: ['AirlineRepresentative', 'AviamAgent'],
  signatures: [{ role: 'AirlineRepresentative', signerName: 'Ana Pérez', signedAt: '2026-11-04T16:00:00Z' }],
  staleRoles: ['AviamAgent'], isFullySigned: false, summary: {},
};

afterEach(() => vi.clearAllMocks());

describe('OperationDocumentsSection (ADR-0032)', () => {
  it('shows who signed, who must sign again, and downloads the PDF', async () => {
    mocks.get.mockResolvedValue({ operationId, documents: [order], damageMarks: [{ id: 'm1' }] });
    mocks.download.mockResolvedValue(undefined);
    render(<OperationDocumentsSection operationId={operationId} />);
    expect(await screen.findByText('Orden de Servicio en Rampa')).toBeTruthy();
    expect(screen.getByText('✓ Ana Pérez')).toBeTruthy();
    expect(screen.getByText('Firmar de nuevo')).toBeTruthy();
    expect(screen.getByText('1 daño(s) marcados en el walk-around')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(operationId, order));
  });

  it('explains a failure as Problem Details text and lets OCC retry', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('No se pudieron cargar los formularios. Intenta nuevamente.'),
      { status: 500 }));
    mocks.get.mockResolvedValueOnce({ operationId, documents: [], damageMarks: [] });
    render(<OperationDocumentsSection operationId={operationId} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      expect.stringContaining('No se pudieron cargar los formularios'));
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Esta operación aún no tiene formularios.')).toBeTruthy();
  });
});
