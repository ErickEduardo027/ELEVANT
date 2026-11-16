import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationEmptyState from './NotificationEmptyState';

describe('NotificationEmptyState', () => {
  it('renders the general empty copy by default', () => {
    render(<NotificationEmptyState />);
    expect(screen.getByText('Sin notificaciones nuevas')).toBeInTheDocument();
  });

  it('renders the filtered empty copy', () => {
    render(<NotificationEmptyState variant="filtered" />);
    expect(screen.getByText('No hay notificaciones en esta categoría.')).toBeInTheDocument();
  });

  it('renders the all-read copy', () => {
    render(<NotificationEmptyState variant="all-read" />);
    expect(screen.getByText('Todas las notificaciones están al día.')).toBeInTheDocument();
  });
});