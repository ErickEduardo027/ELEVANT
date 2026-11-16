import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), readSession: vi.fn(), unauthorized: vi.fn(), documents: vi.fn(), photo: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createClient }));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession, handleUnauthorizedResponse: mocks.unauthorized,
}));

import { getOccDamagePhoto, getOccOperationDocuments } from './occDocumentsService';

const operationId = '70000000-0000-7000-8000-000000000005';
const markId = '84000000-0000-7000-8000-000000000071';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'test-access-token' });
  mocks.createClient.mockReturnValue({ getOccOperationDocuments: mocks.documents, getOccDamagePhoto: mocks.photo });
});

describe('occDocumentsService', () => {
  it('reads the photo of a damage mark with the session and passes cancellation through (3-K)', async () => {
    const controller = new AbortController();
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    mocks.photo.mockResolvedValue(blob);
    await expect(getOccDamagePhoto(operationId, markId, { signal: controller.signal })).resolves.toBe(blob);
    expect(mocks.createClient.mock.calls[0][0].getAccessToken()).toBe('test-access-token');
    expect(mocks.photo).toHaveBeenCalledWith(operationId, markId, { signal: controller.signal });
  });

  it.each([
    [403, 'Tu acceso no incluye las fotos del walk-around de esta operación.'],
    [404, 'La foto de este daño ya no está disponible.'],
    [503, 'Las fotos del walk-around no están disponibles ahora. Intenta en unos minutos.'],
    [500, 'No se pudo cargar la foto del daño. Intenta nuevamente.'],
  ])('explains a %i of the photo in Spanish and keeps its status', async (status, message) => {
    mocks.photo.mockRejectedValue(new ElevantApiError({ kind: 'http', status, title: 'Walk-around photo storage is unavailable.' }));
    await expect(getOccDamagePhoto(operationId, markId)).rejects.toMatchObject({ message, status });
    expect(mocks.unauthorized).not.toHaveBeenCalled();
  });

  it('closes the session on a 401 and lets a cancellation through untouched', async () => {
    mocks.photo.mockRejectedValueOnce(new ElevantApiError({ kind: 'http', status: 401 }));
    await expect(getOccDamagePhoto(operationId, markId)).rejects.toMatchObject({ status: 401 });
    expect(mocks.unauthorized).toHaveBeenCalledWith({ status: 401 });
    const abort = new DOMException('cancelled', 'AbortError');
    mocks.photo.mockRejectedValueOnce(abort);
    await expect(getOccDamagePhoto(operationId, markId)).rejects.toBe(abort);
  });

  it('keeps the forms messages for the forms', async () => {
    mocks.documents.mockRejectedValue(new ElevantApiError({ kind: 'http', status: 404 }));
    await expect(getOccOperationDocuments(operationId)).rejects.toMatchObject({
      message: 'La operación no tiene formularios o no es de tu estación.', status: 404,
    });
  });
});
