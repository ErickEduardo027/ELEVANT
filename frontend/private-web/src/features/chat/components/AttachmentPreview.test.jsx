import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AttachmentPreview from './AttachmentPreview';

describe('AttachmentPreview', () => {
  it('renders name, formatted size and status for a ready image attachment', () => {
    render(<AttachmentPreview attachment={{ id: 'a1', name: 'foto-banda-3.jpg', type: 'image', size: 842000, status: 'ready' }} />);
    expect(screen.getByText('foto-banda-3.jpg')).toBeInTheDocument();
    expect(screen.getByText(/822.3 KB · Listo/)).toBeInTheDocument();
  });

  it('renders the uploading status for a document attachment', () => {
    render(<AttachmentPreview attachment={{ id: 'a2', name: 'evidencia.pdf', type: 'document', size: 210000, status: 'uploading' }} />);
    expect(screen.getByText(/Cargando…/)).toBeInTheDocument();
  });
});
