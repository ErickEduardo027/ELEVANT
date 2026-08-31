// Same path as the existing MapPinIcon (src/features/dashboard/components/icons/index.jsx) —
// copied as a literal string because MapLibre markers take a plain DOM element, not JSX.
const PIN_PATH = 'M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z';

export function createAirportMarkerElement() {
  const element = document.createElement('div');
  element.className = 'flight-monitoring-airport-marker';
  element.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#145DC4" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${PIN_PATH}" /><circle cx="12" cy="9.5" r="2.3" /></svg>`;
  return element;
}
