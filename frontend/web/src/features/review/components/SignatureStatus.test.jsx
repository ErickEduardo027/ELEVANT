import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignatureStatus from './SignatureStatus';

describe('SignatureStatus', () => {
  it('renders every signature with its role and status', () => {
    render(
      <SignatureStatus
        operation={{
          signatures: [
            { name: 'Delta', role: 'Representante de aerolínea', status: 'signed', timestamp: '2026-08-05T15:38:00-04:00' },
            { name: 'Juan Pérez', role: 'Supervisor', status: 'pending', timestamp: null },
          ],
        }}
      />
    );
    expect(screen.getByText('Representante de aerolínea')).toBeInTheDocument();
    expect(screen.getByText('Firmado')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });

  it('shows an attention badge when a required signature is missing', () => {
    render(
      <SignatureStatus
        operation={{ signatures: [{ name: 'Juan Pérez', role: 'Supervisor', status: 'pending', timestamp: null }] }}
      />
    );
    expect(screen.getByText('Firma pendiente')).toBeInTheDocument();
  });

  it('shows no attention badge when every signature is complete', () => {
    render(
      <SignatureStatus
        operation={{ signatures: [{ name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: '2026-08-05T15:38:00-04:00' }] }}
      />
    );
    expect(screen.queryByText('Firma pendiente')).not.toBeInTheDocument();
  });
});
