import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';

// Same path as the existing PlaneIcon (src/features/dashboard/components/icons/index.jsx) —
// copied as a literal string because MapLibre markers take a plain DOM element, not JSX.
const PLANE_PATH = 'M3.5 12.8 20 7.2c.9-.3 1.6.5 1.2 1.3l-2 3.8-6 2-1 4.7-1.6.5-.6-5-4-1.2Z';

function svgMarkup(color) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${PLANE_PATH}" /></svg>`;
}

// MapLibre's Marker writes `element.style.transform` on the element handed to it directly, to
// position it in screen space, on every map `move` event — unconditionally overwriting any
// transform set here. So rotation/scale/transition must live on an INNER child element
// ("rotor") that MapLibre never touches, leaving the root element free for MapLibre's own
// screen-position writes.
const ROTOR_CLASS = 'flight-monitoring-aircraft-marker__rotor';

export function createAircraftMarkerElement(flight, { selected = false } = {}) {
  const element = document.createElement('div');
  element.className = 'flight-monitoring-aircraft-marker';
  element.dataset.flightId = String(flight.id);
  element.style.cursor = 'pointer';

  const rotor = document.createElement('div');
  rotor.className = ROTOR_CLASS;
  rotor.style.transition = 'transform 3.8s linear';
  element.appendChild(rotor);

  updateAircraftMarkerElement(element, flight, { selected });
  return element;
}

export function updateAircraftMarkerElement(element, flight, { selected = false } = {}) {
  const meta = getStatusMeta('flight', flight.status);
  const rotor = element.querySelector(`.${ROTOR_CLASS}`);
  rotor.innerHTML = svgMarkup(STATUS_COLORS[meta.color]);
  // Mirrored into a custom property so the `:hover` rule in tokens.css can recompute the
  // rotation with its own (CSS-owned) scale, without needing to read this inline style back.
  rotor.style.setProperty('--marker-heading', `${flight.heading}deg`);
  rotor.style.transform = `rotate(${flight.heading}deg) scale(${selected ? 1.15 : 1})`;
  element.dataset.selected = String(selected);
}
