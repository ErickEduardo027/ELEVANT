import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DemoTag from './DemoTag';
import { TAGS } from './statusVocabulary';

describe('DemoTag', () => {
  it('says «Demo» as its own text, so the tag is the element a reader and a test find', () => {
    render(<p><span>ZZ9001</span><DemoTag /></p>);

    const tag = screen.getByText(TAGS.demo.es);
    expect(tag).toHaveAttribute('data-occ-tag', 'demo');
    expect(tag.previousElementSibling).toHaveTextContent('ZZ9001');
  });

  it('draws 45° stripes with a hidden SVG pattern in OCC tokens, never with a hue', () => {
    const { container } = render(<DemoTag />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    const pattern = svg.querySelector('pattern');
    expect(pattern).toHaveAttribute('patternTransform', 'rotate(45)');
    expect(svg.querySelector('line').style.stroke).toBe('var(--occ-line)');
    expect(svg.querySelector('rect')).toHaveAttribute('fill', `url(#${pattern.id})`);
  });

  it('gives every tag its own pattern id, so two tags on one screen never share stripes', () => {
    const { container } = render(<><DemoTag /><DemoTag /></>);

    const ids = [...container.querySelectorAll('pattern')].map(pattern => pattern.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^occ-demo-stripes-[a-zA-Z0-9_-]+$/);
  });
});
