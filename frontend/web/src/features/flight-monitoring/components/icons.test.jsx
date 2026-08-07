import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SearchIcon, XIcon, CrosshairIcon, RotateCcwIcon } from './icons';

const ICONS = { SearchIcon, XIcon, CrosshairIcon, RotateCcwIcon };

describe('flight monitoring icon set', () => {
  it.each(Object.entries(ICONS))('%s renders a decorative inline SVG', (name, Icon) => {
    const { container } = render(<Icon className="h-4 w-4" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('h-4', 'w-4');
  });
});
