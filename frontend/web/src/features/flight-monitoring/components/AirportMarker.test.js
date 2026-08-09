import { describe, expect, it } from 'vitest';
import { createAirportMarkerElement } from './AirportMarker';

describe('createAirportMarkerElement', () => {
  it('creates a div with an inline pin SVG in the accent color', () => {
    const element = createAirportMarkerElement();
    expect(element.tagName).toBe('DIV');
    const svg = element.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('stroke')).toBe('#145DC4');
  });
});
