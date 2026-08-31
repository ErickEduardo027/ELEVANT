import { describe, expect, it } from 'vitest';
import { createAircraftMarkerElement, updateAircraftMarkerElement } from './AircraftMarker';

const FLIGHT = { id: 7, status: 'approaching', heading: 90 };

function getRotor(element) {
  return element.querySelector('.flight-monitoring-aircraft-marker__rotor');
}

describe('createAircraftMarkerElement', () => {
  it('creates a div carrying the flight id and an inline plane SVG', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(element.tagName).toBe('DIV');
    expect(element.dataset.flightId).toBe('7');
    expect(element.querySelector('svg')).not.toBeNull();
  });

  it('leaves the root element untouched by rotation/scale styling, since MapLibre owns its transform', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(element.style.transform).toBe('');
    expect(element.style.transition).toBe('');
  });

  it('rotates the inner rotor element to match the flight heading', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(getRotor(element).style.transform).toContain('rotate(90deg)');
  });

  it('applies the position-independent transition to the inner rotor element', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    expect(getRotor(element).style.transition).toBe('transform 3.8s linear');
  });

  it('scales the rotor up when selected', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: true });
    expect(getRotor(element).style.transform).toContain('scale(1.15)');
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

    expect(getRotor(element).style.transform).toContain('rotate(200deg)');
    expect(getRotor(element).style.transform).toContain('scale(1.15)');
    expect(element.querySelector('svg').getAttribute('stroke')).toBe('#1E9E6B');
  });

  it('never writes a transform or transition onto the root element', () => {
    const element = createAircraftMarkerElement(FLIGHT, { selected: false });
    updateAircraftMarkerElement(element, { ...FLIGHT, heading: 200 }, { selected: true });

    expect(element.style.transform).toBe('');
    expect(element.style.transition).toBe('');
  });
});
