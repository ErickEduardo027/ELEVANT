import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, FileGenericIcon, ImageIcon, PaperclipIcon, SendIcon } from './icons';

const ICONS = { SendIcon, PaperclipIcon, ArrowLeftIcon, CheckIcon, FileGenericIcon, ImageIcon, ChevronDownIcon };

describe('chat icon set', () => {
  it.each(Object.entries(ICONS))('%s renders a decorative inline SVG', (name, IconComponent) => {
    const { container } = render(<IconComponent className="h-4 w-4" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('h-4', 'w-4');
  });
});