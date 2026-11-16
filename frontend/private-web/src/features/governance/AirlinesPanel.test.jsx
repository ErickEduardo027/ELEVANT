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

describe('Superadministrador Aerolíneas · identificador fiscal', () => {
  it('defaults the tax country to the airline, masks the RNC and saves its 9 digits', async () => {
    const onSave = vi.fn(async () => true);
    render(<AirlinesPanel airlines={[{ ...airline, countryCode: 'DO' }]} onSave={onSave} onArchive={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Test Airways' }));
    expect(screen.getByRole('textbox', { name: 'País del identificador fiscal' })).toHaveValue('DO');
    const rnc = screen.getByRole('textbox', { name: 'RNC' });
    expect(rnc).toHaveAttribute('inputMode', 'numeric');
    fireEvent.change(rnc, { target: { value: '13123456' } });
    expect(rnc).toHaveValue('1-31-23456');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    expect(screen.getByText('El RNC tiene 9 dígitos.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(rnc, { target: { value: '131234569' } });
    expect(screen.getByText('✓ RNC válido')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toMatchObject({ taxRegistration: '131234569', taxRegistrationCountryCode: 'DO',
      isVerified: false, version: airline.version });
  });

  it('shows a stored RNC with its dashes and takes a foreign identifier as written', async () => {
    const onSave = vi.fn(async () => true);
    render(<AirlinesPanel airlines={[{ ...airline, countryCode: 'ES', taxRegistration: '131234569',
      taxRegistrationCountryCode: 'DO' }, { ...airline, id: 'other', displayName: 'Iberia Test', countryCode: 'ES' }]}
    onSave={onSave} onArchive={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Test Airways' }));
    expect(screen.getByRole('textbox', { name: 'RNC' })).toHaveValue('1-31-23456-9');
    fireEvent.click(screen.getByRole('button', { name: 'Editar Iberia Test' }));
    expect(screen.getByRole('textbox', { name: 'País del identificador fiscal' })).toHaveValue('ES');
    fireEvent.change(screen.getByRole('textbox', { name: 'Identificador fiscal' }), { target: { value: ' B85850394 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toMatchObject({ taxRegistration: 'B85850394', taxRegistrationCountryCode: 'ES' });
  });
});

describe('Superadministrador Aerolíneas · corregir identidad', () => {
  const operating = { ...airline, legalName: 'eeeeeeee', iataCode: 'EE', icaoCode: 'EOI',
    verificationSourceUrl: 'https://junk.example.test', isVerified: true, identityLocked: true };

  it('opens the identity of an operating airline only with a reason, and sends it with the verification', async () => {
    const onSave = vi.fn(async () => true);
    render(<AirlinesPanel airlines={[operating]} onSave={onSave} onArchive={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Test Airways' }));
    expect(screen.getByRole('textbox', { name: 'Razón social' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('textbox', { name: 'Motivo de la corrección' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Corregir identidad' }));
    expect(screen.getByRole('note')).toHaveTextContent('conservan los datos con los que se hicieron');
    for (const name of ['Razón social', 'Código IATA', 'Código ICAO'])
      expect(screen.getByRole('textbox', { name })).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByRole('textbox', { name: 'Razón social' }), { target: { value: 'Delta Air Lines, Inc.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Código IATA' }), { target: { value: 'DL' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Código ICAO' }), { target: { value: 'DAL' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Fuente de verificación' }), { target: { value: 'https://www.delta.com/' } });

    // The reason is required (10 to 500 characters) before anything is sent.
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    expect(screen.getByRole('alert')).toHaveTextContent('10 a 500 caracteres');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo de la corrección' }),
      { target: { value: 'Datos de prueba reemplazados por los oficiales.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toMatchObject({ legalName: 'Delta Air Lines, Inc.', iataCode: 'DL', icaoCode: 'DAL',
      verificationSourceUrl: 'https://www.delta.com/', isVerified: true,
      identityCorrectionReason: 'Datos de prueba reemplazados por los oficiales.', version: airline.version });
  });

  it('keeps the lock and sends no reason while the correction is not chosen', async () => {
    const onSave = vi.fn(async () => true);
    render(<AirlinesPanel airlines={[operating]} onSave={onSave} onArchive={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar Test Airways' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar aerolínea' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).not.toHaveProperty('identityCorrectionReason');
  });
});
