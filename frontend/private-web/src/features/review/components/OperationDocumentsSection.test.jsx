import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ get: vi.fn(), download: vi.fn(), photo: vi.fn() }));
vi.mock('../../../services/occDocumentsService', async importOriginal => ({
  ...(await importOriginal()),
  getOccOperationDocuments: mocks.get,
  downloadOccOperationDocument: mocks.download,
  getOccDamagePhoto: mocks.photo,
}));

import OperationDocumentsSection from './OperationDocumentsSection';

const operationId = '70000000-0000-7000-8000-000000000005';
const order = {
  kind: 'ServiceOrder', number: 'PUJ000000005', title: 'Orden de Servicio', formCode: 'F-RAM-AVL-MAG 04',
  contentSha256: 'a'.repeat(64), requiredRoles: ['AirlineRepresentative', 'AviamAgent'],
  signatures: [{ role: 'AirlineRepresentative', signerName: 'Ana Pérez', signedAt: '2026-11-04T16:00:00Z' }],
  staleRoles: ['AviamAgent'], isFullySigned: false, summary: {},
};

const withPhoto = { id: '84000000-0000-7000-8000-000000000071', x: 0.4, y: 0.3, note: 'Abolladura en la puerta 2L',
  reportedAt: '2026-11-04T16:05:00Z', hasPhoto: true };
const withoutPhoto = { id: '84000000-0000-7000-8000-000000000072', x: 0.6, y: 0.5, note: 'Rayón en el ala',
  reportedAt: '2026-11-04T16:20:00Z', hasPhoto: false };

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

  it('lists the damages in the station time and opens a photo only on demand (3-K)', async () => {
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:damage-photo');
    URL.revokeObjectURL = revokeObjectURL;
    onTestFinished(() => { URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; });
    mocks.get.mockResolvedValue({ operationId, documents: [order], damageMarks: [withPhoto, withoutPhoto] });
    mocks.photo.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
    const { unmount } = render(<OperationDocumentsSection operationId={operationId} timeZone="America/Santo_Domingo" />);
    // 16:05 UTC is 12:05 in Santo Domingo (UTC−4).
    expect(await screen.findByText('Abolladura en la puerta 2L', { exact: false })).toHaveProperty('textContent',
      expect.stringContaining('12:05'));
    expect(screen.getByText('Sin foto')).toBeTruthy();
    expect(mocks.photo).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Ver foto' }));
    expect(await screen.findByRole('img', { name: 'Foto del daño' })).toHaveProperty('src', 'blob:damage-photo');
    expect(mocks.photo).toHaveBeenCalledWith(operationId, withPhoto.id, expect.objectContaining({ signal: expect.anything() }));
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:damage-photo');
  });

  it('explains an unavailable photo storage and retries the photo', async () => {
    mocks.get.mockResolvedValue({ operationId, documents: [order], damageMarks: [withPhoto] });
    mocks.photo.mockRejectedValueOnce(Object.assign(
      new Error('Las fotos del walk-around no están disponibles ahora. Intenta en unos minutos.'), { status: 503 }));
    mocks.photo.mockRejectedValueOnce(Object.assign(
      new Error('Tu acceso no incluye las fotos del walk-around de esta operación.'), { status: 403 }));
    render(<OperationDocumentsSection operationId={operationId} timeZone="America/Santo_Domingo" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ver foto' }));
    expect(await screen.findByText('Las fotos del walk-around no están disponibles ahora. Intenta en unos minutos.'))
      .toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    // Without access there is nothing to retry.
    expect(await screen.findByText('Tu acceso no incluye las fotos del walk-around de esta operación.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
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
