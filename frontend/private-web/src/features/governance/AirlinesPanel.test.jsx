import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AirlinesPanel from './AirlinesPanel';

const airline = {
  id: '20000000-0000-7000-8000-000000000003', sourceName: 'TEST AIRWAYS',
  displayName: 'Test Airways', legalName: null, region: 'Caribe',
  countryCode: null, iataCode: null, icaoCode: null, logoUrl: null,
  sourceUrl: 'https://www.aviamltd.com/nosotros/', verificationSourceUrl: null,
  isVerified: false, isPublished: true, version: 'AAAAAAAABAc=',
};

describe('Superadministrador Aerolíneas', () => {
  it('shows unknown data honestly and saves an edited profile with its version', async () => {
    const onSave = vi.fn(async () => true);
    render(<AirlinesPanel airlines={[airline]} onSave={onSave} onArchive={vi.fn()} />);

    expect(screen.getByText(/Sin dato confirmado/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Test Airways' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Razón social' }),
      { target: { value: 'Test Airways Ltd.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));

    expect(onSave).toHaveBeenCalledWith(airline.id, expect.objectContaining({
      legalName: 'Test Airways Ltd.', sourceName: 'TEST AIRWAYS',
      version: airline.version, isVerified: false,
    }), expect.any(String));
  });

  it('keeps the identity of an operating airline read-only and saves the rest with an Idempotency-Key (1-N20)', async () => {
    const operating = { ...airline, legalName: 'Test Airways S.R.L.', iataCode: 'T7', icaoCode: 'TSW',
      verificationSourceUrl: 'https://aoc.example.gob.do/tsw', isVerified: true, identityLocked: true };
    const onSave = vi.fn(async () => false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<AirlinesPanel airlines={[operating]} onSave={onSave} onArchive={vi.fn()} />);
    expect(screen.getByText(/Opera con AVIAM/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Test Airways' }));
    expect(screen.getByRole('note')).toHaveTextContent('no pueden cambiar desde aquí');
    for (const name of ['Razón social', 'Código IATA', 'Código ICAO'])
      expect(screen.getByRole('textbox', { name })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Nombre visible' })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox', { name: /Datos verificados/ })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre visible' }), { target: { value: 'Test Airways Express' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    const [[id, values, key], [, , retryKey]] = onSave.mock.calls;
    expect(id).toBe(airline.id);
    expect(values).toMatchObject({ displayName: 'Test Airways Express', legalName: 'Test Airways S.R.L.', iataCode: 'T7',
      icaoCode: 'TSW', isVerified: true, version: airline.version });
    // The same save retried after a failure keeps its key; a successful save starts a new intent.
    expect(key).toEqual(expect.any(String));
    expect(retryKey).toBe(key);
  });

  it('checks the airline in the public registry and shows the green seal with its source', async () => {
    const found = { ...airline, displayName: 'Copa Airlines', iataCode: 'CM', icaoCode: 'CMP' };
    const onCheckRegistry = vi.fn(async () => ({
      airline: { ...found, registryStatus: 'Found', registrySource: 'Wikidata' },
      check: { status: 'Found', source: 'Wikidata', differences: [] },
    }));
    const { rerender } = render(<AirlinesPanel airlines={[found]} onSave={vi.fn()} onArchive={vi.fn()} onCheckRegistry={onCheckRegistry} />);
    expect(screen.getByText('Sin verificar en registro')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verificar en registro' }));
    expect(onCheckRegistry).toHaveBeenCalledWith(found.id);
    rerender(<AirlinesPanel airlines={[{ ...found, registryStatus: 'Found', registrySource: 'Wikidata',
      registryEntityUrl: 'https://www.wikidata.org/wiki/Q849404' }]} onSave={vi.fn()} onArchive={vi.fn()} onCheckRegistry={onCheckRegistry} />);
    const seal = await screen.findByText(/Verificada en registro/);
    expect(within(seal).getByRole('link', { name: 'Wikidata' })).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q849404');
  });

  it('explains a mismatch with the differences the registry reported', async () => {
    const onCheckRegistry = vi.fn(async () => ({
      airline: { ...airline, registryStatus: 'Mismatch', registrySource: 'Wikidata' },
      check: { status: 'Mismatch', source: 'Wikidata', differences: ['Con esos códigos el registro muestra «Copa Airlines», no «Test Airways».'] },
    }));
    render(<AirlinesPanel airlines={[airline]} onSave={vi.fn()} onArchive={vi.fn()} onCheckRegistry={onCheckRegistry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verificar en registro' }));
    expect(await screen.findByText(/el registro muestra «Copa Airlines»/)).toBeInTheDocument();
  });
});
