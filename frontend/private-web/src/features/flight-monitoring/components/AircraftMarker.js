import { STATUS_COLORS, getStatusMeta } from '../../dashboard/statusMeta';
import { aircraftSilhouetteSvg } from '../../maps/aircraftSilhouette';

// Silueta de ELEVANT con el morro al norte: rotarla `heading` grados la orienta según el rumbo
// recibido. El contorno claro la mantiene legible sobre cartografía clara, oscura o satelital.
function svgMarkup(color) {
  return aircraftSilhouetteSvg({ fill: color, stroke: '#FFFFFF', strokeWidth: 3, size: 26 });
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
  // Sin rumbo conocido la silueta no se orienta: no se inventa una dirección.
  const heading = Number.isFinite(flight.heading) ? flight.heading : 0;
  rotor.style.setProperty('--marker-heading', `${heading}deg`);
  rotor.style.transform = `rotate(${heading}deg) scale(${selected ? 1.15 : 1})`;
  element.dataset.selected = String(selected);
}
