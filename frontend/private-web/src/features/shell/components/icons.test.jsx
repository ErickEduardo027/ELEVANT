import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LayoutGridIcon, CalendarIcon, RadarIcon, BarChartIcon, MessageCircleIcon } from './icons';

const ICONS = { LayoutGridIcon, CalendarIcon, RadarIcon, BarChartIcon, MessageCircleIcon };

describe('shell icon set', () => {
  it.each(Object.entries(ICONS))('%s renders a decorative inline SVG', (name, IconComponent) => {
    const { container } = render(<IconComponent className="h-4 w-4" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('h-4', 'w-4');
  });
});
