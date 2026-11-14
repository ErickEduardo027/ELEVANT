import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { XIcon } from './icons';

describe('review icon set', () => {
  it('XIcon renders a decorative inline SVG', () => {
    const { container } = render(<XIcon className="h-4 w-4" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('h-4', 'w-4');
  });
});
