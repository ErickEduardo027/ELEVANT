import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FileDropField from './FileDropField';

vi.mock('../features/auth/authService', () => ({ readSession: () => ({ token: 'test-token' }) }));
vi.mock('../services/commercialGovernanceApi', () => ({
  commercialMediaUrl: path => `https://api.elevant.test${path}`,
}));

afterEach(() => vi.unstubAllGlobals());

describe('FileDropField', () => {
  it('rejects an unsupported or oversized image and accepts a valid dropped image', () => {
    const onFile = vi.fn();
    render(<FileDropField label="Foto del servicio" accept="image/png,image/jpeg,image/webp" file={null} onFile={onFile} />);
    const drop = screen.getByRole('button', { name: 'Seleccionar foto del servicio' });
    fireEvent.drop(drop, { dataTransfer: { files: [new File(['<svg/>'], 'fake.svg', { type: 'image/svg+xml' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Seleccione un archivo');
    expect(onFile).not.toHaveBeenCalled();

    const oversized = new File(['x'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 8 * 1024 * 1024 + 1 });
    fireEvent.drop(drop, { dataTransfer: { files: [oversized] } });
    expect(onFile).not.toHaveBeenCalled();

    const valid = new File(['png'], 'rampa.png', { type: 'image/png' });
    fireEvent.drop(drop, { dataTransfer: { files: [valid] } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onFile).toHaveBeenCalledWith(valid);
  });

  it('loads a linked private preview with the current bearer token', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:private-preview'), revokeObjectURL: vi.fn() });
    render(<FileDropField label="Foto del servicio" accept="image/png" file={null}
      onFile={vi.fn()} currentUrl="/api/v1/media/00000000-0000-0000-0000-000000000001" />);
    await waitFor(() => expect(screen.getByAltText('Vista previa de foto del servicio'))
      .toHaveAttribute('src', 'blob:private-preview'));
    expect(fetch).toHaveBeenCalledWith(
      'https://api.elevant.test/api/v1/media/00000000-0000-0000-0000-000000000001',
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });
});