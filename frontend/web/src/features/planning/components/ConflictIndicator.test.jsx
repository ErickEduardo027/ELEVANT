import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConflictIndicator from './ConflictIndicator';

describe('ConflictIndicator', () => {
  it('renders nothing when there is no conflict', () => {
    const { container } = render(<ConflictIndicator conflict={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the conflict label and exposes the reason via the title attribute', () => {
    render(<ConflictIndicator conflict={{ reason: 'Posición B21 con doble asignación' }} />);
    const indicator = screen.getByText('Conflicto');
    expect(indicator).toHaveAttribute('title', 'Posición B21 con doble asignación');
  });
});
