import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatEmptyState from './ChatEmptyState';

describe('ChatEmptyState', () => {
  it('renders the no-selection copy by default', () => {
    render(<ChatEmptyState />);
    expect(screen.getByText('Selecciona una conversación para comenzar')).toBeInTheDocument();
  });

  it('renders the no-conversations copy', () => {
    render(<ChatEmptyState variant="no-conversations" />);
    expect(screen.getByText('No hay conversaciones disponibles')).toBeInTheDocument();
  });

  it('renders the no-results copy', () => {
    render(<ChatEmptyState variant="no-results" />);
    expect(screen.getByText('No se encontraron conversaciones')).toBeInTheDocument();
  });
});
