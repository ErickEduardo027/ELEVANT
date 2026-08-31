import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewPriorityBadge from './ReviewPriorityBadge';

describe('ReviewPriorityBadge', () => {
  it('renders nothing for NORMAL priority', () => {
    const { container } = render(<ReviewPriorityBadge priority="NORMAL" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a warning pill for HIGH priority', () => {
    render(<ReviewPriorityBadge priority="HIGH" />);
    expect(screen.getByText('Prioridad alta')).toBeInTheDocument();
  });

  it('renders a danger pill for CRITICAL priority', () => {
    render(<ReviewPriorityBadge priority="CRITICAL" />);
    expect(screen.getByText('Prioridad crítica')).toBeInTheDocument();
  });
});
