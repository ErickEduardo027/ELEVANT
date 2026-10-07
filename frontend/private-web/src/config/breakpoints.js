// Única fuente de los breakpoints de AVIAM Web. Tailwind (tailwind.config.js)
// y los hooks de JS leen estos mismos valores para que la navegación y los
// layouts cambien exactamente en el mismo píxel.
export const BREAKPOINTS = Object.freeze({
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
  '3xl': 1920,
});

// Consulta "por debajo de" un breakpoint. Termina 0.02px antes del valor para
// no solaparse con el `min-width` que genera Tailwind para el mismo nombre.
export function belowBreakpoint(name) {
  return `(max-width: ${BREAKPOINTS[name] - 0.02}px)`;
}

export const MEDIA_QUERIES = Object.freeze({
  mobile: belowBreakpoint('sm'),
  belowMd: belowBreakpoint('md'),
  belowDesktop: belowBreakpoint('lg'),
});
