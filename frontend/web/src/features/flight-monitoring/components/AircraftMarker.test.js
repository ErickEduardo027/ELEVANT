import { describe, expect, it } from 'vitest';
import { createAircraftMarkerElement, updateAircraftMarkerElement } from './AircraftMarker';

const FLIGHT = { id: 7, status: 'approaching', heading: 90 };

describe('createAircraftMarkerElement', () => {
  it('creates a div carrying the flight id and an inline plane SVG', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(element.tagName).toBe('DIV');
    expect(element.dataset.flightId).toBe('7');
    expect(element.querySelector('svg')).not.toBeNull();
  });

  it('rotates the marker to match the flight heading', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(element.style.transform).toContain('rotate(90deg)');
  });

  it('scales the marker up when selected', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: true });
    expect(element.style.transform).toContain('scale(1.15)');
  });

  it('colors the marker stroke according to the flight status', () => {
    const delayedElement = createAircraftMarkerElement({ ...FLIGHT, status: 'delayed' }, { selected: false });
    expect(delayedElement.querySelector('svg').getAttribute('stroke')).toBe('#D9A441');
  });
});

describe('updateAircraftMarkerElement', () => {
  it('mutates the existing element in place instead of returning a new one', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    updateAircraftMarkerElement(element, { ...FLIGHT, heading: 200, status: 'landed' }, { selected: true });

    expect(element.style.transform).toContain('rotate(200deg)');
    expect(element.style.transform).toContain('scale(1.15)');
    expect(element.querySelector('svg').getAttribute('stroke')).toBe('#1E9E6B');
  });
});
