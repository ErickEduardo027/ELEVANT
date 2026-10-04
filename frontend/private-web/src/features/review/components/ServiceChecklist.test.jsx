import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ServiceChecklist from './ServiceChecklist';

describe('ServiceChecklist', () => {
  it('shows the empty copy when there are no services', () => {
    render(<ServiceChecklist services={[]} />);
    expect(screen.getByText('Sin servicios registrados.')).toBeInTheDocument();
  });

  it('renders each service with its status label', () => {
    render(
      <ServiceChecklist
        services={[
          { name: 'GPU', status: 'completed' },
          { name: 'Catering', status: 'not_required' },
          { name: 'Cleaning', status: 'pending' },
        ]}
      />
    );
    expect(screen.getByText('Completado')).toBeInTheDocument();
    expect(screen.getByText('No requerido')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });
});