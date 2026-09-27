import { fireEvent, render, screen } from '@testing-library/react';
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
    }));
  });
});
